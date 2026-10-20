use std::{
    collections::HashMap,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use chrono::{Local, SecondsFormat};
use serde::Serialize;

use crate::{account::AccountService, backup::BackupService, error::CommandError};

use super::{
    error::ArchiveError,
    model::{
        BackupEvent, BackupSettings, BackupStatus, BackupTargetConfig, BackupTargetMeta,
        BackupVersion, BackupVersionInfo, LegacyConflict,
    },
    repository::ArchiveRepository,
};

pub const ORIGIN_MANUAL: &str = "manual";
pub const ORIGIN_SCHEDULED: &str = "scheduled";
pub const ORIGIN_SHUTDOWN: &str = "shutdown";
pub const ORIGIN_CHANGE: &str = "change";
pub const ORIGIN_RESTORE: &str = "restore";

#[derive(Clone)]
pub(crate) struct ArchiveService {
    pub(super) inner: Arc<ArchiveInner>,
}

pub(super) struct ArchiveInner {
    pub(super) repository: ArchiveRepository,
    pub(super) backup: BackupService,
    pub(super) backup_dir: PathBuf,
    pub(super) device_id: String,
    pub(super) operation: OperationCoordinator,
    pub(super) oauth_states: Mutex<HashMap<String, super::oauth::OAuthState>>,
    pub(super) scheduler: Mutex<Option<super::scheduler::SchedulerRuntime>>,
    pub(super) account: AccountService,
    pub(super) user: i64,
}

#[derive(Default)]
pub(super) struct OperationCoordinator {
    lock: tokio::sync::Mutex<()>,
}

impl OperationCoordinator {
    pub(super) fn try_enter(&self) -> Result<tokio::sync::MutexGuard<'_, ()>, ArchiveError> {
        self.lock.try_lock().map_err(|_| ArchiveError::InProgress)
    }
}

#[derive(Debug, Serialize)]
pub struct BackupNowResult {
    pub created: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<BackupVersion>,
}

#[derive(Debug, Serialize)]
pub struct RestoreResult {
    pub restored: bool,
    pub version: Option<BackupVersion>,
}

impl ArchiveService {
    pub fn initialize(
        repository: ArchiveRepository,
        backup: BackupService,
        backup_dir: PathBuf,
        account: AccountService,
        user: i64,
    ) -> Result<Self, CommandError> {
        std::fs::create_dir_all(&backup_dir).map_err(|error| {
            CommandError::new("SYNC_FAILED", format!("create backup dir: {error}"))
        })?;
        set_private_directory_permissions(&backup_dir).map_err(|error| {
            CommandError::new("SYNC_FAILED", format!("create backup dir: {error}"))
        })?;
        Ok(Self {
            inner: Arc::new(ArchiveInner {
                repository: repository.clone(),
                backup,
                backup_dir,
                device_id: repository.identity()?.0,
                operation: OperationCoordinator::default(),
                oauth_states: Mutex::new(HashMap::new()),
                scheduler: Mutex::new(None),
                account,
                user,
            }),
        })
    }

    pub fn get_settings(&self) -> Result<BackupSettings, CommandError> {
        let mut settings = self.inner.repository.load_settings()?;
        settings.backup_password.clear();
        Ok(settings)
    }

    pub fn reveal_password(&self) -> Result<String, CommandError> {
        let settings = self.inner.repository.load_settings()?;
        if !settings.backup_password_set || settings.backup_password.is_empty() {
            return Err(CommandError::new("NO_PASSWORD", "尚未设置备份密码"));
        }
        Ok(settings.backup_password.clone())
    }

    pub fn save_settings(&self, mut settings: BackupSettings) -> Result<(), CommandError> {
        validate_settings(&mut settings)?;
        self.inner
            .repository
            .save_settings(&settings)
            .map_err(|error| CommandError::new("SETTINGS_FAILED", error.message))
    }

    pub fn local_status(&self) -> Result<BackupStatus, CommandError> {
        let state = self.inner.repository.get_state()?;
        let local_latest = self
            .inner
            .repository
            .latest_version()?
            .as_ref()
            .map(BackupVersionInfo::from);
        let conflict = if state.conflict_json.is_empty() {
            None
        } else {
            serde_json::from_str::<LegacyConflict>(&state.conflict_json).ok()
        };
        let providers = self.list_providers()?;
        Ok(BackupStatus {
            status: state.status,
            local_latest,
            cloud_latest: Default::default(),
            providers,
            conflict,
            last_sync_at: state.last_sync_at,
        })
    }

    pub fn list_versions(&self) -> Result<Vec<BackupVersion>, CommandError> {
        self.inner.repository.list_versions()
    }

    pub fn list_events(&self, limit: i64) -> Result<Vec<BackupEvent>, CommandError> {
        self.inner.repository.list_events(limit)
    }

    pub fn create_version(&self, origin: &str) -> Result<Option<BackupVersion>, CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        self.create_version_inner(origin)
    }

    pub(super) fn create_version_inner(
        &self,
        origin: &str,
    ) -> Result<Option<BackupVersion>, CommandError> {
        let settings = self.inner.repository.load_settings()?;
        if settings.backup_password.is_empty() {
            return Err(password_required());
        }
        let password_revision = self.inner.repository.password_revision()?;
        let (bytes, hash) = self
            .inner
            .backup
            .build_backup_version(&settings.backup_password)?;
        if self
            .inner
            .repository
            .latest_version()?
            .is_some_and(|latest| {
                latest.hash == hash && latest.password_revision == password_revision
            })
        {
            return Ok(None);
        }
        let number = self.inner.repository.next_version()?;
        let filename = format!("v{number:06}-{}.eizhubackup", &hash[..12]);
        let path = self.inner.backup_dir.join(filename);
        write_private_file(&path, &bytes).map_err(|error| {
            CommandError::new("SYNC_FAILED", format!("write version file: {error}"))
        })?;
        let version = BackupVersion {
            id: uuid::Uuid::new_v4().to_string(),
            version: number,
            hash,
            size: i64::try_from(bytes.len()).unwrap_or(i64::MAX),
            file_path: path.display().to_string(),
            password_revision,
            origin: origin.into(),
            synced_to: vec![],
            created_at: now(),
        };
        if let Err(error) = self.inner.repository.add_version(&version) {
            let _ = std::fs::remove_file(&path);
            return Err(error);
        }
        self.inner
            .repository
            .log_event("", "backup", number, true, "");
        self.prune_local_versions()?;
        Ok(Some(version))
    }

    fn prune_local_versions(&self) -> Result<(), CommandError> {
        let settings = self.inner.repository.load_settings()?;
        if settings.local_keep_versions <= 0 || settings.cloud_retention != "keep_forever" {
            return Ok(());
        }
        for version in self
            .inner
            .repository
            .list_versions()?
            .into_iter()
            .skip(settings.local_keep_versions as usize)
        {
            // The operation coordinator protects the immutable version being uploaded.
            // Superseded versions never need to be uploaded by latest-only backups.
            self.delete_version(&version.id, true)?;
        }
        Ok(())
    }

    pub(super) fn has_pending_upload(&self) -> Result<bool, CommandError> {
        let Some(version) = self.inner.repository.latest_version()? else {
            return Ok(false);
        };
        Ok(self
            .inner
            .repository
            .list_providers(true)?
            .iter()
            .any(|provider| !version.synced_to.contains(&provider.meta.id)))
    }

    pub fn delete_version(&self, id: &str, force: bool) -> Result<(), CommandError> {
        let version = self
            .inner
            .repository
            .get_version(id)
            .map_err(|error| CommandError::new("DELETE_FAILED", error.message))?;
        if !force && version.synced_to.is_empty() {
            return Err(CommandError::new(
                "DELETE_FAILED",
                "该版本尚未同步到任何云端，删除后将无法恢复（可用 force 强制删除）",
            ));
        }
        if let Err(error) = std::fs::remove_file(&version.file_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(CommandError::new("DELETE_FAILED", error.to_string()));
            }
        }
        self.inner
            .repository
            .log_event("", "delete", version.version, true, "user");
        self.inner
            .repository
            .delete_version(id)
            .map_err(|error| CommandError::new("DELETE_FAILED", error.message))
    }

    pub fn restore_version(&self, id: &str) -> Result<Option<BackupVersion>, CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        let settings = self.inner.repository.load_settings()?;
        let version = self.inner.repository.get_version(id)?;
        let bytes = std::fs::read(&version.file_path).map_err(|error| {
            CommandError::new("SYNC_FAILED", format!("读取版本文件失败: {error}"))
        })?;
        self.inner.backup.restore_backup_version(
            &bytes,
            &settings.backup_password,
            &version.hash,
            "版本文件校验失败（内容 hash 不匹配），文件可能已损坏或备份密码已变更",
        )?;
        self.inner
            .repository
            .log_event("", "restore", version.version, true, "");
        self.create_version_inner(ORIGIN_RESTORE)
    }

    pub async fn preview_legacy_account(
        &self,
        password: String,
    ) -> Result<serde_json::Value, CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        let password = zeroize::Zeroizing::new(password);
        let index_bytes = self
            .inner
            .account
            .backup_object(
                self.inner.user,
                reqwest::Method::GET,
                "api/store/objects/index.json",
                None,
                true,
            )
            .await?;
        let index: super::model::CloudIndex =
            serde_json::from_slice(&index_bytes).map_err(CommandError::database)?;
        let version = index
            .latest()
            .ok_or_else(|| CommandError::new("VERSION_NOT_FOUND", "旧账号空间没有完整版本"))?;
        if version.object.is_empty()
            || version.object.len() > 200
            || !version
                .object
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        {
            return Err(CommandError::new(
                "INVALID_OBJECT_NAME",
                "旧备份对象名称无效",
            ));
        }
        let bytes = self
            .inner
            .account
            .backup_object(
                self.inner.user,
                reqwest::Method::GET,
                &format!("api/store/objects/{}", version.object),
                None,
                false,
            )
            .await?;
        let path = self
            .inner
            .backup_dir
            .join(format!("preview-legacy-{}", uuid::Uuid::new_v4()));
        let backup = self.inner.backup.clone();
        let hash = version.hash.clone();
        let mut preview = tokio::task::spawn_blocking(move || {
            write_private_file(&path, &bytes).map_err(CommandError::database)?;
            let result = backup.prepare_restore(
                path.to_str()
                    .ok_or_else(|| CommandError::new("INVALID_PATH", "备份路径无效"))?,
                &password,
                Some(&hash),
            );
            let _ = std::fs::remove_file(path);
            result
        })
        .await
        .map_err(CommandError::database)??;
        preview["source"] = serde_json::json!({"kind":"legacy_account", "version":version.version, "object":version.object, "createdAt":version.created_at});
        Ok(preview)
    }

    pub fn list_providers(&self) -> Result<Vec<BackupTargetMeta>, CommandError> {
        self.inner
            .repository
            .list_providers(false)?
            .into_iter()
            .map(|mut row| {
                if matches!(row.config.provider_type.as_str(), "gdrive" | "onedrive") {
                    row.meta.authorized = row.config.authorized();
                }
                Ok(row.meta)
            })
            .collect()
    }

    pub fn create_provider(
        &self,
        config: BackupTargetConfig,
    ) -> Result<BackupTargetMeta, CommandError> {
        validate_provider(&config)?;
        self.inner
            .repository
            .create_provider(&config)
            .map(|row| row.meta)
            .map_err(|error| CommandError::new("INVALID_PROVIDER", error.message))
    }

    pub fn update_provider(
        &self,
        id: &str,
        config: BackupTargetConfig,
    ) -> Result<(), CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        validate_provider(&config)
            .map_err(|error| CommandError::new("UPDATE_FAILED", error.message))?;
        self.inner
            .repository
            .update_provider(id, &config)
            .map_err(|error| CommandError::new("UPDATE_FAILED", error.message))
    }

    pub fn delete_provider(&self, id: &str) -> Result<(), CommandError> {
        let _operation = self.inner.operation.try_enter()?;
        self.inner
            .repository
            .delete_provider(id)
            .map_err(|error| CommandError::new("DELETE_FAILED", error.message))
    }
}

pub fn validate_settings(settings: &mut BackupSettings) -> Result<(), CommandError> {
    if !matches!(settings.sync_mode.as_str(), "manual" | "auto") {
        return Err(CommandError::new(
            "INVALID_SETTINGS",
            "sync_mode 须为 manual | auto",
        ));
    }
    if !matches!(settings.conflict_policy.as_str(), "prompt" | "latest") {
        return Err(CommandError::new(
            "INVALID_SETTINGS",
            "conflict_policy 须为 prompt | latest",
        ));
    }
    if !matches!(
        settings.cloud_retention.as_str(),
        "keep_forever" | "mirror_local"
    ) {
        return Err(CommandError::new(
            "INVALID_SETTINGS",
            "cloud_retention 须为 keep_forever | mirror_local",
        ));
    }
    if !settings.scheduled_daily_time.is_empty()
        && (settings.scheduled_daily_time.len() != 5
            || settings.scheduled_daily_time.as_bytes().get(2) != Some(&b':'))
    {
        return Err(CommandError::new(
            "INVALID_SETTINGS",
            "scheduled_daily_time 格式须为 HH:MM",
        ));
    }
    settings.change_debounce_seconds = settings.change_debounce_seconds.max(5);
    Ok(())
}

pub fn validate_provider(config: &BackupTargetConfig) -> Result<(), CommandError> {
    if config.name.is_empty() {
        return Err(CommandError::new("INVALID_PROVIDER", "名称不能为空"));
    }
    match config.provider_type.as_str() {
        "webdav" if config.endpoint.is_empty() => {
            Err(CommandError::new("INVALID_PROVIDER", "WebDAV 地址不能为空"))
        }
        "s3" if config.s3_bucket.is_empty() || config.s3_access_key.is_empty() => Err(
            CommandError::new("INVALID_PROVIDER", "S3 Bucket 与 AccessKey 不能为空"),
        ),
        "gdrive" | "onedrive" if config.oauth_client_id.is_empty() => Err(CommandError::new(
            "INVALID_PROVIDER",
            "OAuth Client ID 不能为空（需在对应云平台注册应用获取）",
        )),
        "webdav" | "s3" | "gdrive" | "onedrive" | "account" => Ok(()),
        other => Err(CommandError::new(
            "INVALID_PROVIDER",
            format!("暂不支持的云服务类型: {other}"),
        )),
    }
}

pub fn password_required() -> CommandError {
    CommandError::new("SYNC_PASSWORD_REQUIRED", "请先在数据备份中配置备份密码")
}

pub(crate) fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn now() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        account::AccountService,
        audit::AuditRepository,
        backup::archive::repository::ArchiveRepository,
        group::GroupService,
        infrastructure::database::Database,
        profile::ProfileService,
        vault::{Encryptor, VaultService},
    };

    fn state() -> (tempfile::TempDir, ArchiveService) {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::initialize(directory.path().join("eizhu.db")).unwrap();
        let encryptor = Encryptor::load_or_create(directory.path().join("key")).unwrap();
        let audit = AuditRepository::new(database.clone());
        let groups = GroupService::new(database.clone());
        let vault = VaultService::new(database.clone(), encryptor.clone(), audit.clone());
        let profiles =
            ProfileService::initialize(database.clone(), encryptor.clone(), vault.clone()).unwrap();
        let backup = BackupService::new(
            database.clone(),
            encryptor.clone(),
            audit,
            groups,
            profiles,
            vault,
        );
        let repository = ArchiveRepository::new(database.clone(), encryptor.clone());
        let account = AccountService::initialize(database, encryptor).unwrap();
        let state = ArchiveService::initialize(
            repository,
            backup,
            directory.path().join("backups"),
            account,
            0,
        )
        .unwrap();
        (directory, state)
    }

    #[tokio::test]
    async fn personal_cloud_backups_submit_only_latest_and_retry_targets_independently() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let fail = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let uploads = Arc::new(Mutex::new(Vec::<String>::new()));
        let objects = Arc::new(Mutex::new(HashMap::<String, Vec<u8>>::new()));
        let failures = fail.clone();
        let recorded = uploads.clone();
        let store = objects.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let fail = failures.clone();
                let uploads = recorded.clone();
                let objects = store.clone();
                tokio::spawn(async move {
                    let mut raw = Vec::new();
                    let mut buffer = [0u8; 4096];
                    let end;
                    loop {
                        let n = stream.read(&mut buffer).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        raw.extend_from_slice(&buffer[..n]);
                        if let Some(position) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                            end = position + 4;
                            break;
                        }
                    }
                    let header = String::from_utf8_lossy(&raw[..end]);
                    let mut line = header.lines().next().unwrap().split_whitespace();
                    let method = line.next().unwrap().to_owned();
                    let path = line.next().unwrap().to_owned();
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    while raw.len() < end + length {
                        let n = stream.read(&mut buffer).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        raw.extend_from_slice(&buffer[..n]);
                    }
                    let mut code = "200 OK";
                    let mut body = Vec::new();
                    if path.starts_with("/bad/") && fail.load(std::sync::atomic::Ordering::Acquire)
                    {
                        code = "503 Service Unavailable";
                    } else if method == "PUT" {
                        objects
                            .lock()
                            .unwrap()
                            .insert(path.clone(), raw[end..end + length].to_vec());
                        if path.ends_with(".eizhubackup") {
                            uploads.lock().unwrap().push(path);
                        }
                    } else if method == "GET" {
                        if let Some(saved) = objects.lock().unwrap().get(&path) {
                            body = saved.clone();
                        } else {
                            code = "404 Not Found";
                        }
                    }
                    let header = format!(
                        "HTTP/1.1 {code}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        body.len()
                    );
                    stream.write_all(header.as_bytes()).await.unwrap();
                    stream.write_all(&body).await.unwrap();
                });
            }
        });
        let (dir, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "independent-backup-password".into();
        state.save_settings(settings).unwrap();
        for name in ["good", "bad"] {
            let mut config = BackupTargetConfig::default();
            config.provider_type = "webdav".into();
            config.name = name.into();
            config.enabled = true;
            config.endpoint = format!("http://{address}/{name}/");
            state.create_provider(config).unwrap();
        }
        let db = Database::initialize(dir.path().join("eizhu.db")).unwrap();
        for n in 1..=3 {
            db.connect()
                .unwrap()
                .execute(
                    "INSERT INTO groups(id,name) VALUES(?1,?1)",
                    [format!("group-{n}")],
                )
                .unwrap();
            state.create_version(ORIGIN_MANUAL).unwrap();
        }
        let cancel = tokio_util::sync::CancellationToken::new();
        assert!(state.push_latest_cancellable(&cancel).await.is_err());
        assert!(state.has_pending_upload().unwrap());
        let latest = state.list_versions().unwrap().remove(0);
        assert_eq!(latest.synced_to.len(), 1);
        assert_eq!(latest.version, 3);
        fail.store(false, std::sync::atomic::Ordering::Release);
        state.push_latest_cancellable(&cancel).await.unwrap();
        assert!(!state.has_pending_upload().unwrap());
        let uploads = uploads.lock().unwrap();
        assert_eq!(uploads.len(), 2);
        assert!(uploads.iter().all(|path| path.contains("v000003-")));
        assert_eq!(state.list_versions().unwrap()[0].synced_to.len(), 2);
        server.abort();
    }

    #[test]
    fn changing_backup_password_creates_a_new_version_and_preserves_old_restore() {
        let (_dir, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "old-password".into();
        state.save_settings(settings).unwrap();
        let first = state.create_version(ORIGIN_MANUAL).unwrap().unwrap();
        let mut settings = state.get_settings().unwrap();
        settings.backup_password = "new-password".into();
        state.save_settings(settings).unwrap();
        let second = state.create_version(ORIGIN_MANUAL).unwrap().unwrap();
        assert_eq!(first.hash, second.hash);
        assert_eq!(second.version, first.version + 1);
        assert_ne!(first.password_revision, second.password_revision);
        state
            .inner
            .backup
            .prepare_restore(&first.file_path, "old-password", Some(&first.hash))
            .unwrap();
        state
            .inner
            .backup
            .prepare_restore(&second.file_path, "new-password", Some(&second.hash))
            .unwrap();
        assert!(state.create_version(ORIGIN_MANUAL).unwrap().is_none());
    }

    #[test]
    fn editing_a_backup_target_reconfirms_latest_version_and_cannot_race_upload() {
        let (_dir, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "backup-password".into();
        state.save_settings(settings).unwrap();
        let mut target = BackupTargetConfig::default();
        target.provider_type = "webdav".into();
        target.name = "personal backup".into();
        target.endpoint = "https://old.example.invalid".into();
        target.enabled = true;
        let meta = state.create_provider(target.clone()).unwrap();
        let version = state.create_version(ORIGIN_MANUAL).unwrap().unwrap();
        state
            .inner
            .repository
            .mark_synced(&version.id, &meta.id)
            .unwrap();
        assert!(!state.has_pending_upload().unwrap());
        let upload = state.inner.operation.try_enter().unwrap();
        target.endpoint = "https://new.example.invalid".into();
        assert_eq!(
            state
                .update_provider(&meta.id, target.clone())
                .unwrap_err()
                .code,
            "SYNC_IN_PROGRESS"
        );
        drop(upload);
        state.update_provider(&meta.id, target).unwrap();
        assert!(state.has_pending_upload().unwrap());
        assert!(state.create_version(ORIGIN_MANUAL).unwrap().is_none());
        assert_eq!(state.list_versions().unwrap()[0].id, version.id);
    }

    #[test]
    fn concurrent_target_confirmations_preserve_every_target_and_are_idempotent() {
        let (_dir, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "backup-password".into();
        state.save_settings(settings).unwrap();
        let version = state.create_version(ORIGIN_MANUAL).unwrap().unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut tasks = Vec::new();
        for target in ["first", "second"] {
            let repo = state.inner.repository.clone();
            let id = version.id.clone();
            let barrier = barrier.clone();
            tasks.push(std::thread::spawn(move || {
                barrier.wait();
                repo.mark_synced(&id, target).unwrap();
                repo.mark_synced(&id, target).unwrap();
            }));
        }
        barrier.wait();
        for task in tasks {
            task.join().unwrap();
        }
        let saved = state.inner.repository.get_version(&version.id).unwrap();
        assert_eq!(saved.synced_to.len(), 2);
        assert!(saved.synced_to.contains(&"first".into()));
        assert!(saved.synced_to.contains(&"second".into()));
    }

    #[test]
    fn local_retention_removes_superseded_unsent_versions_and_migration_preserves_password_independence(
    ) {
        let (dir, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "backup-password".into();
        settings.local_keep_versions = 2;
        state.save_settings(settings).unwrap();
        let db = Database::initialize(dir.path().join("eizhu.db")).unwrap();
        let c = db.connect().unwrap();
        let mut files = Vec::new();
        for n in 1..=3 {
            c.execute(
                "INSERT INTO groups(id,name) VALUES(?1,?1)",
                [format!("group-{n}")],
            )
            .unwrap();
            files.push(
                state
                    .create_version(ORIGIN_MANUAL)
                    .unwrap()
                    .unwrap()
                    .file_path,
            );
        }
        assert_eq!(state.list_versions().unwrap().len(), 2);
        assert!(!Path::new(&files[0]).exists());
        assert!(Path::new(&files[2]).exists());
        c.execute(
            "UPDATE sync_settings SET value='old-value' WHERE key='sync_password'",
            [],
        )
        .unwrap();
        let reopened = Database::initialize(dir.path().join("eizhu.db")).unwrap();
        let stored: String = reopened
            .connect()
            .unwrap()
            .query_row(
                "SELECT value FROM backup_settings WHERE key='backup_password'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let encryptor = Encryptor::load_existing(dir.path().join("key")).unwrap();
        assert_eq!(encryptor.decrypt(&stored).unwrap(), "backup-password");
    }

    #[test]
    fn settings_password_is_encrypted_preserved_and_hidden() {
        let (_directory, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "secret-password".into();
        state.save_settings(settings).unwrap();
        assert!(state.get_settings().unwrap().backup_password.is_empty());
        assert!(state.get_settings().unwrap().backup_password_set);
        assert_eq!(state.reveal_password().unwrap(), "secret-password");

        let mut update = state.get_settings().unwrap();
        update.local_keep_versions = 7;
        state.save_settings(update).unwrap();
        assert_eq!(state.reveal_password().unwrap(), "secret-password");
    }

    #[test]
    fn create_deduplicates_and_restore_verifies_hash() {
        let (_directory, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "secret-password".into();
        state.save_settings(settings).unwrap();
        let first = state.create_version(ORIGIN_MANUAL).unwrap().unwrap();
        assert_eq!(first.version, 1);
        assert!(state.create_version(ORIGIN_MANUAL).unwrap().is_none());
        assert!(Path::new(&first.file_path).exists());
        assert!(state.restore_version(&first.id).unwrap().is_none());

        std::fs::write(&first.file_path, b"corrupt").unwrap();
        assert!(state.restore_version(&first.id).is_err());
    }

    #[test]
    fn unsynced_versions_require_force_to_delete() {
        let (_directory, state) = state();
        let mut settings = BackupSettings::default();
        settings.backup_password = "secret-password".into();
        state.save_settings(settings).unwrap();
        let version = state.create_version(ORIGIN_MANUAL).unwrap().unwrap();
        assert_eq!(
            state.delete_version(&version.id, false).unwrap_err().code,
            "DELETE_FAILED"
        );
        state.delete_version(&version.id, true).unwrap();
        assert!(state.list_versions().unwrap().is_empty());
    }

    #[test]
    fn operation_coordinator_rejects_overlapping_mutations() {
        let (_directory, state) = state();
        let _operation = state.inner.operation.try_enter().unwrap();
        assert_eq!(
            state.create_version(ORIGIN_MANUAL).unwrap_err().code,
            "SYNC_IN_PROGRESS"
        );
    }

    #[test]
    fn scheduler_requests_report_when_runtime_is_stopped() {
        let (_directory, state) = state();
        assert_eq!(
            state.request_sync().unwrap_err().code,
            "SYNC_SCHEDULER_STOPPED"
        );
    }

    #[test]
    fn scheduler_starts_without_an_entered_runtime() {
        let (_directory, state) = state();
        let runtime = tokio::runtime::Runtime::new().unwrap();

        state.start_scheduler(runtime.handle()).unwrap();
        runtime.block_on(state.stop_scheduler());
    }

    #[test]
    fn validation_matches_go_contract() {
        let mut settings = BackupSettings::default();
        settings.change_debounce_seconds = 1;
        validate_settings(&mut settings).unwrap();
        assert_eq!(settings.change_debounce_seconds, 5);
        settings.sync_mode = "invalid".into();
        assert_eq!(
            validate_settings(&mut settings).unwrap_err().code,
            "INVALID_SETTINGS"
        );
    }
}
