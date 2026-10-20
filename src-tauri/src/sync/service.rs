use super::{crypto, model::*, repository::SyncRepository};
use crate::{
    account::AccountService, error::CommandError, infrastructure::database::Database,
    vault::Encryptor,
};
use reqwest::Method;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use zeroize::Zeroizing;

#[derive(Clone)]
pub(crate) struct SyncService {
    pub(super) inner: Arc<SyncInner>,
}
pub(super) struct SyncInner {
    pub repository: SyncRepository,
    pub blocking: Mutex<usize>,
    pub quiescent: tokio::sync::Notify,
    pub account: AccountService,
    pub user: i64,
    pub device: String,
    pub paused: std::sync::atomic::AtomicBool,
    pub blocked: std::sync::atomic::AtomicBool,
    pub resume: tokio::sync::Notify,
    pub wake: tokio::sync::Notify,
    pub stop: tokio_util::sync::CancellationToken,
    pub operation: tokio::sync::Mutex<()>,
    pub runtime: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
    pub emit: Arc<dyn Fn(Value) + Send + Sync>,
    previews: Mutex<HashMap<String, Preview>>,
}
struct BlockingWork(Arc<SyncInner>);
impl Drop for BlockingWork {
    fn drop(&mut self) {
        if let Ok(mut count) = self.0.blocking.lock() {
            *count -= 1;
        }
        self.0.quiescent.notify_waiters();
    }
}
struct Preview {
    generation: i64,
    seq: i64,
    epoch: i64,
    items: Vec<Item>,
}
impl SyncService {
    pub fn new(
        database: Database,
        encryptor: Encryptor,
        account: AccountService,
        user: i64,
        device: String,
        emit: Arc<dyn Fn(Value) + Send + Sync>,
    ) -> Self {
        Self {
            inner: Arc::new(SyncInner {
                repository: SyncRepository::new(database, encryptor),
                blocking: Mutex::new(0),
                quiescent: tokio::sync::Notify::new(),
                account,
                user,
                device,
                paused: std::sync::atomic::AtomicBool::new(false),
                blocked: std::sync::atomic::AtomicBool::new(false),
                resume: tokio::sync::Notify::new(),
                wake: tokio::sync::Notify::new(),
                stop: tokio_util::sync::CancellationToken::new(),
                operation: tokio::sync::Mutex::new(()),
                runtime: Mutex::new(Vec::new()),
                emit,
                previews: Mutex::new(HashMap::new()),
            }),
        }
    }
    pub(super) async fn local<T: Send + 'static>(
        &self,
        work: impl FnOnce(SyncRepository) -> Result<T, CommandError> + Send + 'static,
    ) -> Result<T, CommandError> {
        {
            let mut count = self
                .inner
                .blocking
                .lock()
                .map_err(|_| CommandError::new("SYNC_BUSY", "同步任务状态不可用"))?;
            if self.inner.stop.is_cancelled() {
                return Err(CommandError::new("WORKSPACE_CHANGED", "数据空间已切换"));
            }
            *count += 1;
        }
        let guard = BlockingWork(self.inner.clone());
        let repository = self.inner.repository.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = guard;
            work(repository)
        })
        .await
        .map_err(CommandError::database)?
    }
    pub(super) async fn emit_async(&self) {
        if let Ok(status) = self.local(|r| r.status()).await {
            if let Ok(body) = serde_json::to_value(status) {
                (self.inner.emit)(body);
            }
        }
    }
    pub fn pause(&self, paused: bool) {
        self.inner
            .paused
            .store(paused, std::sync::atomic::Ordering::Release);
        if paused {
            self.notify_change();
        } else {
            self.retry_now();
        }
    }
    pub fn retry_now(&self) {
        self.inner
            .blocked
            .store(false, std::sync::atomic::Ordering::Release);
        self.inner.resume.notify_one();
        self.notify_change();
    }
    pub fn notify_change(&self) {
        self.inner.wake.notify_one();
    }
    pub fn status(&self) -> Result<SyncStatus, CommandError> {
        self.inner.repository.status()
    }
    pub fn conflicts(&self) -> Result<Vec<Conflict>, CommandError> {
        self.inner.repository.conflicts()
    }
    pub async fn unlock(&self, password: String) -> Result<(), CommandError> {
        let _lock = self.inner.operation.lock().await;
        let password = Zeroizing::new(password);
        let user = self.inner.user;
        if user <= 0 {
            return Err(CommandError::new("ACCOUNT_NOT_LOGGED_IN", "请先登录账号"));
        }
        let account = self.inner.account.clone();
        let capabilities: Value = account
            .json_for(user, Method::GET, "api/sync/v2/capabilities", None)
            .await?;
        if capabilities["protocol"] != 2 {
            return Err(CommandError::new(
                "SYNC_PROTOCOL",
                "云端尚未支持条目同步协议",
            ));
        }
        let _: Value = account
            .json_for(
                user,
                Method::POST,
                "api/sync/v2/devices",
                Some(json!({"deviceId":self.inner.device})),
            )
            .await?;
        let envelope: Result<crypto::KeyEnvelope, _> = account
            .json_for(user, Method::GET, "api/sync/v2/keys", None)
            .await;
        let (key, envelope) = match envelope {
            Ok(envelope) => {
                let owned = password.clone();
                let copy = envelope.clone();
                let key = self
                    .local(move |_| crypto::unwrap(&owned, &copy, user))
                    .await?;
                (key, envelope)
            }
            Err(error) if error.code == "KEY_NOT_FOUND" => {
                let mut bytes = Zeroizing::new([0u8; 32]);
                getrandom::fill(bytes.as_mut()).map_err(CommandError::database)?;
                let owned = password.clone();
                let copy = bytes.clone();
                let envelope = self
                    .local(move |_| crypto::wrap(&owned, &copy, user, 0))
                    .await?;
                let created = account
                    .json_for(
                        user,
                        Method::PUT,
                        "api/sync/v2/keys",
                        Some(serde_json::to_value(&envelope).map_err(CommandError::database)?),
                    )
                    .await;
                match created {
                    Ok(saved) => (bytes, saved),
                    Err(error) if error.code == "KEY_CONFLICT" => {
                        let saved: crypto::KeyEnvelope = account
                            .json_for(user, Method::GET, "api/sync/v2/keys", None)
                            .await?;
                        let copy = saved.clone();
                        let owned = password.clone();
                        let key = self
                            .local(move |_| crypto::unwrap(&owned, &copy, user))
                            .await?;
                        (key, saved)
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        };
        self.local(move |r| r.save_key(&key, &envelope, &password))
            .await?;
        self.retry_now();
        self.emit_async().await;
        Ok(())
    }
    pub async fn change_password(&self, password: String) -> Result<(), CommandError> {
        let _lock = self.inner.operation.lock().await;
        let key = self
            .local(|r| r.key())
            .await?
            .ok_or_else(|| CommandError::new("SYNC_LOCKED", "请先解锁"))?;
        let current: crypto::KeyEnvelope = self
            .inner
            .account
            .json_for(self.inner.user, Method::GET, "api/sync/v2/keys", None)
            .await?;
        let password = Zeroizing::new(password);
        let copy = key.clone();
        let owned = password.clone();
        let user = self.inner.user;
        let next = self
            .local(move |_| crypto::wrap(&owned, &copy, user, current.revision))
            .await?;
        let saved: crypto::KeyEnvelope = self
            .inner
            .account
            .json_for(
                user,
                Method::PUT,
                "api/sync/v2/keys",
                Some(serde_json::to_value(next).map_err(CommandError::database)?),
            )
            .await?;
        self.local(move |r| r.save_key(&key, &saved, &password))
            .await
    }
    pub async fn preview(&self) -> Result<Value, CommandError> {
        let _lock = self.inner.operation.lock().await;
        let (snapshot, items) = self.download_snapshot().await?;
        let (generation,local_count)=self.local(|r| {
            let mut c=r.database.connect()?;let tx=c.transaction().map_err(CommandError::database)?;
            let generation:i64=tx.query_row("SELECT next_generation FROM realtime_state WHERE id=1",[],|r|r.get(0)).map_err(CommandError::database)?;
            let count:i64=tx.query_row("SELECT (SELECT count(*) FROM groups)+(SELECT count(*) FROM profiles)+(SELECT count(*) FROM vault)+(SELECT count(*) FROM snippets)",[],|r|r.get(0)).map_err(CommandError::database)?;
            tx.commit().map_err(CommandError::database)?;Ok((generation,count))
        }).await?;
        let token = uuid::Uuid::new_v4().to_string();
        let cloud_count = items.iter().filter(|i| !i.deleted).count();
        let preview = Preview {
            generation,
            seq: snapshot["seq"].as_i64().unwrap_or(0),
            epoch: snapshot["epoch"].as_i64().unwrap_or(1),
            items,
        };
        let mut previews = self
            .inner
            .previews
            .lock()
            .map_err(|_| CommandError::new("SYNC_BUSY", "接入状态不可用"))?;
        previews.clear();
        previews.insert(token.clone(), preview);
        Ok(json!({"token":token,"localCount":local_count,"cloudCount":cloud_count}))
    }
    async fn download_snapshot(&self) -> Result<(Value, Vec<Item>), CommandError> {
        let snapshot: Value = self
            .inner
            .account
            .json_for(
                self.inner.user,
                Method::POST,
                "api/sync/v2/snapshots",
                Some(json!({})),
            )
            .await?;
        let id = snapshot["snapshotId"]
            .as_str()
            .ok_or_else(|| CommandError::new("SYNC_PROTOCOL", "快照响应无效"))?;
        let mut offset = 0;
        let mut items = Vec::new();
        loop {
            let page: Value = self
                .inner
                .account
                .json_for(
                    self.inner.user,
                    Method::GET,
                    &format!("api/sync/v2/snapshots/{id}?offset={offset}"),
                    None,
                )
                .await?;
            let mut values: Vec<Item> =
                serde_json::from_value(page["items"].clone()).map_err(CommandError::database)?;
            if values.iter().any(|item| item.key_version != 1) {
                return Err(CommandError::new("SYNC_PROTOCOL", "条目密钥版本暂不支持"));
            }
            items.append(&mut values);
            if page["hasMore"] != true {
                break;
            }
            offset = page["offset"]
                .as_i64()
                .ok_or_else(|| CommandError::new("SYNC_PROTOCOL", "快照分页无效"))?;
        }
        Ok((snapshot, items))
    }
    async fn recover_snapshot(&self, key: &[u8; 32]) -> Result<(), CommandError> {
        let (head, items) = self.download_snapshot().await?;
        let epoch = head["epoch"]
            .as_i64()
            .ok_or_else(|| CommandError::new("SYNC_PROTOCOL", "数据代次无效"))?;
        let seq = head["seq"]
            .as_i64()
            .ok_or_else(|| CommandError::new("SYNC_PROTOCOL", "云端水位无效"))?;
        let batch = Batch {
            request_id: "recovery".into(),
            seq,
            epoch,
            items,
        };
        let key = Zeroizing::new(*key);
        let user = self.inner.user;
        self.local(move |r| r.rebase_snapshot(&batch, &key, user))
            .await?;
        self.emit_async().await;
        Ok(())
    }
    pub async fn bootstrap(&self, token: &str, mode: &str) -> Result<(), CommandError> {
        if !matches!(mode, "merge" | "use_local" | "use_cloud") {
            return Err(CommandError::new(
                "INVALID_CHOICE",
                "请选择合并、本地或云端",
            ));
        }
        let _lock = self.inner.operation.lock().await;
        let preview = self
            .inner
            .previews
            .lock()
            .map_err(|_| CommandError::new("SYNC_BUSY", "接入状态不可用"))?
            .remove(token)
            .ok_or_else(|| CommandError::new("PREVIEW_EXPIRED", "请重新预览"))?;
        let key = self
            .local(|r| r.key())
            .await?
            .ok_or_else(|| CommandError::new("SYNC_LOCKED", "请先解锁"))?;
        let state: Value = self
            .inner
            .account
            .json_for(
                self.inner.user,
                Method::GET,
                "api/sync/v2/capabilities",
                None,
            )
            .await?;
        if state["seq"].as_i64() != Some(preview.seq)
            || state["epoch"].as_i64() != Some(preview.epoch)
        {
            return Err(CommandError::new(
                "PREVIEW_CHANGED",
                "云端数据已变化，请重新预览",
            ));
        }
        let batch = Batch {
            request_id: "initial".into(),
            seq: preview.seq,
            epoch: preview.epoch,
            items: preview.items,
        };
        let device = self.inner.device.clone();
        let user = self.inner.user;
        let mode = mode.to_owned();
        self.local(move |r| {
            if mode == "use_local" {
                r.prepare_local_replace(&batch, preview.generation, &key, user, &device)
            } else {
                r.apply_initial(&batch, &key, user, preview.generation, mode == "use_cloud")
            }
        })
        .await?;
        self.retry_now();
        self.emit_async().await;
        Ok(())
    }
    pub async fn resolve(
        &self,
        kind: &str,
        id: &str,
        choice: &str,
        expected_revision: Option<i64>,
    ) -> Result<(), CommandError> {
        let _lock = self.inner.operation.lock().await;
        let key = self
            .local(|r| r.key())
            .await?
            .ok_or_else(|| CommandError::new("SYNC_LOCKED", "请先解锁"))?;
        self.pull(&key).await?;
        let kind = kind.to_owned();
        let id = id.to_owned();
        let choice = choice.to_owned();
        let user = self.inner.user;
        self.local(move |r| r.resolve(&kind, &id, &choice, expected_revision, &key, user))
            .await?;
        self.retry_now();
        self.emit_async().await;
        Ok(())
    }
    async fn pull(&self, key: &[u8; 32]) -> Result<(), CommandError> {
        let (mut cursor, epoch, _) = self.local(|r| r.state()).await?;
        let mut until = 0;
        loop {
            let changes: Changes = match self
                .inner
                .account
                .json_for(
                    self.inner.user,
                    Method::GET,
                    &format!("api/sync/v2/changes?after={cursor}&until={until}"),
                    None,
                )
                .await
            {
                Ok(v) => v,
                Err(error) if error.code == "CURSOR_EXPIRED" => {
                    return self.recover_snapshot(key).await;
                }
                Err(error) => return Err(error),
            };
            until = changes.until;
            for batch in changes.batches {
                if batch.epoch != epoch {
                    return self.recover_snapshot(key).await;
                }
                let owned_key = Zeroizing::new(*key);
                let user = self.inner.user;
                self.local(move |r| r.apply_batch(&batch, &owned_key, user))
                    .await?;
            }
            cursor = changes.cursor;
            self.local(move |r| {
                r.database
                    .connect()?
                    .execute("UPDATE realtime_state SET cursor=?1 WHERE id=1", [cursor])
                    .map_err(CommandError::database)?;
                Ok(())
            })
            .await?;
            if !changes.has_more {
                break;
            }
        }
        Ok(())
    }
    async fn ack_async(&self, push: &Push, ids: &[i64]) -> Result<(), CommandError> {
        let push = push.clone();
        let ids = ids.to_vec();
        self.local(move |r| r.ack(&push, &ids)).await
    }
    pub(super) async fn sync_once(&self) -> Result<(), CommandError> {
        let _lock = self.inner.operation.lock().await;
        if self.inner.user <= 0 {
            return Ok(());
        }
        let (_, _, initialized) = self.local(|r| r.state()).await?;
        if !initialized {
            return Ok(());
        }
        let key = self
            .local(|r| r.key())
            .await?
            .ok_or_else(|| CommandError::new("SYNC_LOCKED", "请先解锁"))?;
        self.local(|r| r.set_status("syncing", "")).await?;
        self.emit_async().await;
        // Unknown requests are resolved before pulling our own already-committed changes.
        if let Some((push, ids)) = self.local(|r| r.frozen()).await? {
            let result: Result<Batch, _> = self
                .inner
                .account
                .json_for(
                    self.inner.user,
                    Method::GET,
                    &format!("api/sync/v2/requests/{}", push.request_id),
                    None,
                )
                .await;
            match result {
                Ok(_) => {
                    self.ack_async(&push, &ids).await?;
                }
                Err(e) if e.code == "REQUEST_NOT_FOUND" => {}
                Err(e) => return Err(e),
            }
        }
        self.pull(&key).await?;
        let frozen = self.local(|r| r.frozen()).await?;
        let (push, ids) = if let Some(value) = frozen {
            value
        } else {
            let owned_key = key.clone();
            let user = self.inner.user;
            let device = self.inner.device.clone();
            let Some(value) = self
                .local(move |r| r.freeze_pending(&owned_key, user, &device))
                .await?
            else {
                self.local(|r| r.set_status("synced", "")).await?;
                self.emit_async().await;
                return Ok(());
            };
            value
        };
        let result: Result<Batch, _> = self
            .inner
            .account
            .json_for(
                self.inner.user,
                Method::POST,
                "api/sync/v2/push",
                Some(serde_json::to_value(&push).map_err(CommandError::database)?),
            )
            .await;
        match result {
            Ok(_) => {
                self.ack_async(&push, &ids).await?;
                self.pull(&key).await?;
            }
            Err(error)
                if matches!(
                    error.code,
                    "ITEM_CONFLICT" | "WATERMARK_CHANGED" | "EPOCH_CHANGED"
                ) =>
            {
                if push.replace {
                    self.inner
                        .repository
                        .database
                        .connect()?
                        .execute("UPDATE realtime_state SET initialized=0 WHERE id=1", [])
                        .map_err(CommandError::database)?;
                }
                let request_id = push.request_id.clone();
                self.local(move |r| r.thaw(&request_id)).await?;
                self.pull(&key).await?;
                self.notify_change();
                return Ok(());
            }
            Err(error) => return Err(error),
        }
        let pending = self
            .local(|r| {
                let pending = r.status()?.pending_count;
                r.set_status(if pending > 0 { "pending" } else { "synced" }, "")?;
                Ok(pending)
            })
            .await?;
        self.emit_async().await;
        if pending > 0 {
            self.notify_change();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[tokio::test]
    async fn stopping_a_workspace_joins_blocking_work_and_rejects_late_operations() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::initialize(dir.path().join("db")).unwrap();
        let encryptor = Encryptor::load_or_create(dir.path().join("key")).unwrap();
        let account = AccountService::initialize(db.clone(), encryptor.clone()).unwrap();
        let state = SyncService::new(db, encryptor, account, 1, "device".into(), Arc::new(|_| {}));
        let started = Arc::new(tokio::sync::Notify::new());
        let signal = started.clone();
        let (release, wait) = std::sync::mpsc::channel();
        let owned = state.clone();
        let work = tokio::spawn(async move {
            owned
                .local(move |_| {
                    signal.notify_one();
                    wait.recv().unwrap();
                    Ok(())
                })
                .await
        });
        started.notified().await;
        let owned = state.clone();
        let mut stopping = tokio::spawn(async move { owned.stop().await });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), &mut stopping)
                .await
                .is_err()
        );
        release.send(()).unwrap();
        work.await.unwrap().unwrap();
        stopping.await.unwrap();
        assert_eq!(
            state.local(|r| r.status()).await.err().unwrap().code,
            "WORKSPACE_CHANGED"
        );
    }

    #[tokio::test]
    async fn committed_request_with_lost_response_is_recovered_without_losing_a_later_edit() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let committed = Arc::new(Mutex::new(Vec::<Value>::new()));
        let records = committed.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let records = records.clone();
                tokio::spawn(async move {
                    let mut raw = Vec::new();
                    let mut buffer = [0u8; 4096];
                    let header_end;
                    loop {
                        let n = stream.read(&mut buffer).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        raw.extend_from_slice(&buffer[..n]);
                        if let Some(end) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                            header_end = end + 4;
                            break;
                        }
                    }
                    let headers = String::from_utf8_lossy(&raw[..header_end]);
                    let path = headers
                        .lines()
                        .next()
                        .unwrap()
                        .split_whitespace()
                        .nth(1)
                        .unwrap()
                        .to_owned();
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    while raw.len() < header_end + length {
                        let n = stream.read(&mut buffer).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        raw.extend_from_slice(&buffer[..n]);
                    }
                    let request: Value = if length > 0 {
                        serde_json::from_slice(&raw[header_end..header_end + length]).unwrap()
                    } else {
                        Value::Null
                    };
                    let mut code = "200 OK";
                    let response = if path == "/api/auth/login" {
                        json!({"accessToken":"test-access","refreshToken":"test-refresh","expiresIn":1800,"user":{"id":1,"email":"test@eizhu","storageUsed":0,"storageQuota":1000000}})
                    } else if path.starts_with("/api/sync/v2/requests/") {
                        let id = path.rsplit('/').next().unwrap();
                        let saved = records
                            .lock()
                            .unwrap()
                            .iter()
                            .find(|v| v["requestId"] == id)
                            .cloned();
                        match saved {
                            Some(value) => value,
                            None => {
                                code = "404 Not Found";
                                json!({"code":"REQUEST_NOT_FOUND"})
                            }
                        }
                    } else if path.starts_with("/api/sync/v2/changes") {
                        let seq = records.lock().unwrap().len();
                        json!({"batches":records.lock().unwrap().clone(),"cursor":seq,"until":seq,"hasMore":false})
                    } else if path == "/api/sync/v2/push" {
                        let mut records = records.lock().unwrap();
                        let seq = records.len() + 1;
                        let result = json!({"requestId":request["requestId"],"seq":seq,"epoch":1,"items":request["items"]});
                        records.push(result.clone());
                        if seq == 1 {
                            return;
                        }
                        result
                    } else {
                        panic!("unexpected test request: {path}")
                    };
                    let body = response.to_string();
                    let header=format!("HTTP/1.1 {code}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",body.len());
                    stream.write_all(header.as_bytes()).await.unwrap();
                    stream.write_all(body.as_bytes()).await.unwrap();
                });
            }
        });
        let directory = tempfile::tempdir().unwrap();
        let db = Database::initialize(directory.path().join("db")).unwrap();
        let encryptor = Encryptor::load_or_create(directory.path().join("key")).unwrap();
        let capture = encryptor.clone();
        db.configure_capture(move |value| capture.encrypt(value).map_err(|e| e.to_string()));
        let account = AccountService::with_server(
            db.clone(),
            encryptor.clone(),
            &format!("http://{address}"),
        )
        .unwrap();
        account.login("test@eizhu", "password").await.unwrap();
        let sync = SyncService::new(
            db.clone(),
            encryptor,
            account,
            1,
            uuid::Uuid::new_v4().to_string(),
            Arc::new(|_| {}),
        );
        let envelope = crypto::KeyEnvelope {
            salt: String::new(),
            time: 3,
            memory: 65536,
            threads: 2,
            wrapped_key: String::new(),
            version: 1,
            revision: 1,
        };
        sync.inner
            .repository
            .save_key(&[8; 32], &envelope, "password")
            .unwrap();
        db.connect()
            .unwrap()
            .execute("UPDATE realtime_state SET initialized=1 WHERE id=1", [])
            .unwrap();
        db.connect()
            .unwrap()
            .execute(
                "INSERT INTO groups(id,name) VALUES('server-group','first')",
                [],
            )
            .unwrap();
        assert!(sync.sync_once().await.is_err());
        assert_eq!(committed.lock().unwrap().len(), 1);
        db.connect()
            .unwrap()
            .execute(
                "UPDATE groups SET name='second' WHERE id='server-group'",
                [],
            )
            .unwrap();
        sync.sync_once().await.unwrap();
        assert_eq!(committed.lock().unwrap().len(), 2);
        assert_eq!(sync.status().unwrap().pending_count, 0);
        assert_eq!(
            sync.inner
                .repository
                .revision("group", "server-group")
                .unwrap(),
            2
        );
        let c = db.connect().unwrap();
        let name: String = c
            .query_row("SELECT name FROM groups WHERE id='server-group'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(name, "second");
        server.abort();
    }
}
