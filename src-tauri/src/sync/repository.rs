use super::{crypto, model::*};
use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::Value;
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone)]
pub(super) struct SyncRepository {
    pub database: Database,
    pub encryptor: Encryptor,
}
pub(super) struct Pending {
    pub id: i64,
    pub batch: String,
    pub kind: String,
    pub item_id: String,
    pub generation: i64,
    pub deleted: bool,
    pub payload: String,
}
pub(super) struct SensitiveJson(pub Value);
impl Drop for SensitiveJson {
    fn drop(&mut self) {
        fn clear(v: &mut Value) {
            match v {
                Value::String(s) => s.zeroize(),
                Value::Array(a) => a.iter_mut().for_each(clear),
                Value::Object(o) => o.values_mut().for_each(clear),
                _ => (),
            }
        }
        clear(&mut self.0);
    }
}
impl SyncRepository {
    pub fn new(database: Database, encryptor: Encryptor) -> Self {
        Self {
            database,
            encryptor,
        }
    }
    pub fn state(&self) -> Result<(i64, i64, bool), CommandError> {
        self.database
            .connect()?
            .query_row(
                "SELECT cursor,epoch,initialized FROM realtime_state WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(CommandError::database)
    }
    pub fn status(&self) -> Result<SyncStatus, CommandError> {
        let c = self.database.connect()?;
        let (mut status,cursor,initialized,key,last_confirmed,last_error):(String,i64,bool,Option<String>,Option<String>,String)=c.query_row("SELECT status,cursor,initialized,local_key,last_confirmed,last_error FROM realtime_state WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(CommandError::database)?;
        let conflict_count = c
            .query_row("SELECT count(*) FROM realtime_conflicts", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(CommandError::database)?;
        let mut statement=c.prepare("SELECT q.item_type,q.item_id,max(q.generation),q.deleted,EXISTS(SELECT 1 FROM realtime_conflicts f WHERE f.item_type=q.item_type AND f.item_id=q.item_id) FROM realtime_outbox q GROUP BY q.item_type,q.item_id ORDER BY max(q.generation)").map_err(CommandError::database)?;
        let items = statement
            .query_map([], |r| {
                Ok(ItemStatus {
                    item_type: r.get(0)?,
                    item_id: r.get(1)?,
                    generation: r.get(2)?,
                    deleted: r.get(3)?,
                    status: if r.get::<_, bool>(4)? {
                        "conflict".into()
                    } else if status == "syncing" {
                        "syncing".into()
                    } else {
                        "pending".into()
                    },
                })
            })
            .map_err(CommandError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)?;
        if !items.is_empty() && status == "synced" {
            status = "pending".into();
        }
        if conflict_count > 0 && status != "syncing" {
            status = "conflict".into();
        }
        if !initialized {
            status = "pending_setup".into();
        } else if key.is_none() {
            status = "locked".into();
        }
        Ok(SyncStatus {
            status,
            pending_count: items.len() as i64,
            conflict_count,
            cursor,
            initialized,
            unlocked: key.is_some(),
            last_confirmed,
            last_error,
            items,
        })
    }
    pub fn set_status(&self, status: &str, error: &str) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute(
                "UPDATE realtime_state SET status=?1,last_error=?2 WHERE id=1",
                params![status, error],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }
    pub fn key(&self) -> Result<Option<Zeroizing<[u8; 32]>>, CommandError> {
        let raw: Option<String> = self
            .database
            .connect()?
            .query_row("SELECT local_key FROM realtime_state WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(CommandError::database)?;
        raw.map(|raw| {
            let decoded = Zeroizing::new(
                self.encryptor
                    .decrypt(&raw)
                    .map_err(|_| CommandError::new("SYNC_KEY", "设备同步密钥无法解密"))?,
            );
            use base64::Engine;
            let bytes = Zeroizing::new(
                base64::engine::general_purpose::STANDARD
                    .decode(decoded.as_bytes())
                    .map_err(CommandError::database)?,
            );
            if bytes.len() != 32 {
                return Err(CommandError::new("SYNC_KEY", "同步密钥长度错误"));
            }
            let mut key = Zeroizing::new([0; 32]);
            key.copy_from_slice(&bytes);
            Ok(key)
        })
        .transpose()
    }
    pub fn save_key(
        &self,
        key: &[u8; 32],
        envelope: &crypto::KeyEnvelope,
        password: &str,
    ) -> Result<(), CommandError> {
        use base64::Engine;
        let encoded = Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(key));
        let encrypted = self
            .encryptor
            .encrypt(&encoded)
            .map_err(CommandError::database)?;
        let password = self
            .encryptor
            .encrypt(password)
            .map_err(CommandError::database)?;
        self.database
            .connect()?
            .execute(
                "UPDATE realtime_state SET local_key=?1,wrapped_key=?2,password=?3 WHERE id=1",
                params![
                    encrypted,
                    serde_json::to_string(envelope).map_err(CommandError::database)?,
                    password
                ],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }
    #[cfg(test)]
    pub fn pending(&self) -> Result<Vec<Pending>, CommandError> {
        let c = self.database.connect()?;
        self.pending_on(&c)
    }
    fn pending_on(&self, c: &rusqlite::Connection) -> Result<Vec<Pending>, CommandError> {
        let mut statement = c.prepare("SELECT id,batch_id,item_type,item_id,generation,deleted,payload FROM realtime_outbox q WHERE NOT EXISTS(SELECT 1 FROM realtime_outbox b JOIN realtime_conflicts f ON f.item_type=b.item_type AND f.item_id=b.item_id WHERE b.batch_id=q.batch_id) ORDER BY id").map_err(CommandError::database)?;
        let rows = statement
            .query_map([], |r| {
                Ok(Pending {
                    id: r.get(0)?,
                    batch: r.get(1)?,
                    kind: r.get(2)?,
                    item_id: r.get(3)?,
                    generation: r.get(4)?,
                    deleted: r.get(5)?,
                    payload: r.get(6)?,
                })
            })
            .map_err(CommandError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)?;
        let mut batches = Vec::<Vec<Pending>>::new();
        let mut positions = std::collections::HashMap::new();
        for row in rows {
            let position = *positions.entry(row.batch.clone()).or_insert_with(|| {
                batches.push(Vec::new());
                batches.len() - 1
            });
            batches[position].push(row);
        }
        for batch in batches {
            let mut blocked = false;
            for pending in &batch {
                if pending.deleted {
                    continue;
                }
                let value = self.portable(&pending.payload, &pending.kind)?;
                let mut references = Vec::new();
                if pending.kind == "group" {
                    references.push((
                        "group",
                        value.0["parent_id"].as_str().unwrap_or_default().to_owned(),
                    ));
                }
                if pending.kind == "profile" {
                    references.push((
                        "group",
                        value.0["group_id"].as_str().unwrap_or_default().to_owned(),
                    ));
                    references.push((
                        "vault",
                        value.0["vault_id"].as_str().unwrap_or_default().to_owned(),
                    ));
                    let options = if let Some(raw) = value.0["options"].as_str() {
                        serde_json::from_str::<Value>(raw).map_err(CommandError::database)?
                    } else {
                        value.0["options"].clone()
                    };
                    if options["proxy"]["type"] == "jump" {
                        references.push((
                            "profile",
                            options["proxy"]["jump_profile_id"]
                                .as_str()
                                .unwrap_or_default()
                                .to_owned(),
                        ));
                    }
                }
                for (kind, id) in references.into_iter().filter(|(_, id)| !id.is_empty()) {
                    let conflict: bool = c.query_row("SELECT EXISTS(SELECT 1 FROM realtime_conflicts WHERE item_type=?1 AND item_id=?2)", params![kind,id], |r|r.get(0)).map_err(CommandError::database)?;
                    let pending_dependency:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM realtime_outbox WHERE item_type=?1 AND item_id=?2 AND id<?3 AND batch_id!=?4)",params![kind,id,pending.id,pending.batch],|r|r.get(0)).map_err(CommandError::database)?;
                    blocked |= conflict || pending_dependency;
                }
            }
            if !blocked {
                return Ok(batch);
            }
        }
        Ok(Vec::new())
    }
    pub fn has_work(&self) -> Result<bool, CommandError> {
        Ok(self.frozen()?.is_some() || !self.pending_on(&self.database.connect()?)?.is_empty())
    }
    pub fn portable(&self, raw: &str, kind: &str) -> Result<SensitiveJson, CommandError> {
        let plain = Zeroizing::new(
            self.encryptor
                .decrypt(raw)
                .map_err(CommandError::database)?,
        );
        let mut v = SensitiveJson(serde_json::from_str(&plain).map_err(CommandError::database)?);
        let fields: &[&str] = match kind {
            "vault" => &["data"],
            "profile" => &["inline_credential", "proxy_credential"],
            _ => &[],
        };
        for field in fields {
            if let Some(raw) =
                v.0.get(*field)
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
            {
                let decoded = self
                    .encryptor
                    .decrypt(raw)
                    .map_err(CommandError::database)?;
                v.0[*field] = Value::String(decoded);
            }
        }
        Ok(v)
    }
    #[cfg(test)]
    pub fn revision(&self, kind: &str, id: &str) -> Result<i64, CommandError> {
        Self::revision_on(&self.database.connect()?, kind, id)
    }
    fn revision_on(c: &rusqlite::Connection, kind: &str, id: &str) -> Result<i64, CommandError> {
        c.query_row(
            "SELECT revision FROM realtime_items WHERE item_type=?1 AND item_id=?2",
            params![kind, id],
            |r| r.get(0),
        )
        .optional()
        .map(|v| v.unwrap_or(0))
        .map_err(CommandError::database)
    }
    pub fn frozen(&self) -> Result<Option<(Push, Vec<i64>)>, CommandError> {
        self.database.connect()?.query_row("SELECT body,queue_ids FROM realtime_requests WHERE status='pending' ORDER BY rowid LIMIT 1",[],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().map_err(CommandError::database)?.map(|(body,ids)|Ok((serde_json::from_str(&body).map_err(CommandError::database)?,serde_json::from_str(&ids).map_err(CommandError::database)?))).transpose()
    }
    #[cfg(test)]
    pub fn freeze(&self, push: &Push, ids: &[i64]) -> Result<(), CommandError> {
        Self::freeze_on(&self.database.connect()?, push, ids)
    }
    fn freeze_on(c: &rusqlite::Connection, push: &Push, ids: &[i64]) -> Result<(), CommandError> {
        c.execute(
            "INSERT INTO realtime_requests(request_id,body,queue_ids) VALUES(?1,?2,?3)",
            params![
                push.request_id,
                serde_json::to_string(push).map_err(CommandError::database)?,
                serde_json::to_string(ids).map_err(CommandError::database)?
            ],
        )
        .map_err(CommandError::database)?;
        Ok(())
    }
    pub fn ack(&self, push: &Push, ids: &[i64]) -> Result<(), CommandError> {
        let mut c = self.database.connect()?;
        let tx = c.transaction().map_err(CommandError::database)?;
        for item in &push.items {
            tx.execute("INSERT INTO realtime_items(item_type,item_id,revision) VALUES(?1,?2,?3) ON CONFLICT(item_type,item_id) DO UPDATE SET revision=max(revision,excluded.revision)",params![item.item_type,item.item_id,item.revision]).map_err(CommandError::database)?;
        }
        for id in ids {
            tx.execute("DELETE FROM realtime_outbox WHERE id=?1", [id])
                .map_err(CommandError::database)?;
        }
        if push.replace {
            tx.execute(
                "UPDATE realtime_state SET epoch=?1 WHERE id=1",
                [push.epoch + 1],
            )
            .map_err(CommandError::database)?;
        }
        tx.execute(
            "UPDATE realtime_requests SET status='confirmed' WHERE request_id=?1",
            [&push.request_id],
        )
        .map_err(CommandError::database)?;
        tx.execute(
            "UPDATE realtime_state SET last_confirmed=CURRENT_TIMESTAMP,last_error='' WHERE id=1",
            [],
        )
        .map_err(CommandError::database)?;
        tx.commit().map_err(CommandError::database)
    }
    pub fn thaw(&self, id: &str) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute(
                "DELETE FROM realtime_requests WHERE request_id=?1 AND status='pending'",
                [id],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }
    pub fn apply_batch(
        &self,
        batch: &Batch,
        key: &[u8; 32],
        user: i64,
    ) -> Result<(), CommandError> {
        self.apply_batch_mode(batch, key, user, None, false, None)
    }
    pub fn rebase_snapshot(
        &self,
        batch: &Batch,
        key: &[u8; 32],
        user: i64,
    ) -> Result<(), CommandError> {
        self.apply_batch_mode(batch, key, user, None, true, None)
    }
    fn apply_batch_mode(
        &self,
        batch: &Batch,
        key: &[u8; 32],
        user: i64,
        replace: Option<i64>,
        rebase: bool,
        initial: Option<i64>,
    ) -> Result<(), CommandError> {
        let mut c = self.database.connect()?;
        c.query_row("SELECT eizhu_capture_enabled(0)", [], |_| Ok(()))
            .map_err(CommandError::database)?;
        let tx = c
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(CommandError::database)?;
        if let Some(expected) = initial {
            Self::check_generation(&tx, expected)?;
            self.save_safety(&tx)?;
            if replace.is_none() {
                Self::seed_on(&tx)?;
            }
            tx.execute(
                "UPDATE realtime_state SET epoch=?1,cursor=0 WHERE id=1",
                [batch.epoch],
            )
            .map_err(CommandError::database)?;
        }
        let own:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM realtime_requests WHERE request_id=?1 AND status='confirmed')",[&batch.request_id],|r|r.get(0)).map_err(CommandError::database)?;
        let mut values = Vec::new();
        for item in &batch.items {
            if item.key_version != 1 {
                return Err(CommandError::new("SYNC_PROTOCOL", "条目密钥版本暂不支持"));
            }
            let bytes = crypto::open(
                key,
                &item.payload,
                &crypto::aad(
                    user,
                    &item.item_type,
                    &item.item_id,
                    item.revision,
                    item.epoch.unwrap_or(batch.epoch),
                    item.deleted,
                )?,
            )?;
            let value =
                SensitiveJson(serde_json::from_slice(&bytes).map_err(CommandError::database)?);
            if value.0["id"].as_str() != Some(item.item_id.as_str()) {
                return Err(CommandError::new("SYNC_CONTENT", "条目标识与密文不一致"));
            }
            values.push((item, value));
        }
        if rebase {
            self.save_safety(&tx)?;
            tx.execute("UPDATE realtime_items SET revision=0", [])
                .map_err(CommandError::database)?;
            tx.execute("DELETE FROM realtime_requests WHERE status='pending'", [])
                .map_err(CommandError::database)?;
            tx.execute(
                "UPDATE realtime_state SET epoch=?1,cursor=0 WHERE id=1",
                [batch.epoch],
            )
            .map_err(CommandError::database)?;
        }
        if let Some(expected) = replace {
            let generation: i64 = tx
                .query_row(
                    "SELECT next_generation FROM realtime_state WHERE id=1",
                    [],
                    |r| r.get(0),
                )
                .map_err(CommandError::database)?;
            if generation != expected {
                return Err(CommandError::new(
                    "PREVIEW_CHANGED",
                    "本地数据已变化，请重新预览",
                ));
            }
            self.save_safety(&tx)?;
            tx.execute_batch("DELETE FROM profiles;DELETE FROM snippets;UPDATE groups SET parent_id=NULL;DELETE FROM groups;DELETE FROM vault;DELETE FROM realtime_outbox;DELETE FROM realtime_conflicts;DELETE FROM realtime_items;DELETE FROM realtime_requests;").map_err(CommandError::database)?;
        }
        values.sort_by_key(|(i, _)| match (i.deleted, i.item_type.as_str()) {
            (false, "group") => 0,
            (false, "vault") => 1,
            (false, "profile") => 2,
            (false, _) => 3,
            (true, "profile") => 4,
            (true, "snippet") => 5,
            (true, "vault") => 6,
            _ => 7,
        });
        let mut deferred = Vec::new();
        for (item, remote) in values {
            let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM realtime_outbox WHERE item_type=?1 AND item_id=?2)",params![item.item_type,item.item_id],|r|r.get(0)).map_err(CommandError::database)?;
            let known: i64 = tx
                .query_row(
                    "SELECT revision FROM realtime_items WHERE item_type=?1 AND item_id=?2",
                    params![item.item_type, item.item_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(CommandError::database)?
                .unwrap_or(0);
            if own || item.revision <= known {
                continue;
            }
            if pending {
                let local:Option<(bool,String)>=tx.query_row("SELECT deleted,payload FROM realtime_outbox WHERE item_type=?1 AND item_id=?2 ORDER BY id DESC LIMIT 1",params![item.item_type,item.item_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(CommandError::database)?;
                let equivalent = local
                    .as_ref()
                    .map(|(deleted, raw)| {
                        if *deleted != item.deleted {
                            return Ok::<bool, CommandError>(false);
                        }
                        if *deleted {
                            return Ok::<bool, CommandError>(true);
                        }
                        let local = self.portable(raw, &item.item_type)?;
                        Ok(equivalent(&local.0, &remote.0))
                    })
                    .transpose()?
                    .unwrap_or(false);
                if equivalent {
                    tx.execute(
                        "DELETE FROM realtime_outbox WHERE item_type=?1 AND item_id=?2",
                        params![item.item_type, item.item_id],
                    )
                    .map_err(CommandError::database)?;
                    set_revision(&tx, item)?;
                } else {
                    save_conflict(&tx, item, "concurrent_edit", batch.epoch)?;
                }
            } else {
                match self.apply_item(&tx, item, &remote.0) {
                    Ok(()) => {
                        set_revision(&tx, item)?;
                    }
                    Err(error) if error.code == "SYNC_DEPENDENCY" => deferred.push((item, remote)),
                    Err(error) => return Err(error),
                }
            }
        }
        while !deferred.is_empty() {
            let before = deferred.len();
            let mut remaining = Vec::new();
            for (item, remote) in deferred {
                match self.apply_item(&tx, item, &remote.0) {
                    Ok(()) => set_revision(&tx, item)?,
                    Err(error) if error.code == "SYNC_DEPENDENCY" => remaining.push((item, remote)),
                    Err(error) => return Err(error),
                }
            }
            if remaining.len() == before {
                for (item, _) in remaining {
                    save_conflict(&tx, item, "dependency", batch.epoch)?;
                }
                break;
            }
            deferred = remaining;
        }
        loop {
            let mut statement=tx.prepare("SELECT remote FROM realtime_conflicts f WHERE reason='dependency' AND NOT EXISTS(SELECT 1 FROM realtime_outbox q WHERE q.item_type=f.item_type AND q.item_id=f.item_id)").map_err(CommandError::database)?;
            let saved = statement
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(CommandError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(CommandError::database)?;
            drop(statement);
            let mut progress = false;
            for raw in saved {
                let item: Item = serde_json::from_str(&raw).map_err(CommandError::database)?;
                let plain = crypto::open(
                    key,
                    &item.payload,
                    &crypto::aad(
                        user,
                        &item.item_type,
                        &item.item_id,
                        item.revision,
                        item.epoch.unwrap_or(batch.epoch),
                        item.deleted,
                    )?,
                )?;
                let value =
                    SensitiveJson(serde_json::from_slice(&plain).map_err(CommandError::database)?);
                match self.apply_item(&tx, &item, &value.0) {
                    Ok(()) => {
                        set_revision(&tx, &item)?;
                        progress = true;
                    }
                    Err(e) if e.code == "SYNC_DEPENDENCY" => {}
                    Err(e) => return Err(e),
                }
            }
            if !progress {
                break;
            }
        }
        tx.execute(
            "UPDATE realtime_state SET cursor=max(cursor,?1) WHERE id=1",
            [batch.seq],
        )
        .map_err(CommandError::database)?;
        if initial.is_some() {
            tx.execute(
                "UPDATE realtime_state SET initialized=1,status='pending',user_id=?1 WHERE id=1",
                [user],
            )
            .map_err(CommandError::database)?;
        }
        tx.commit().map_err(CommandError::database)
    }
    pub fn apply_initial(
        &self,
        batch: &Batch,
        key: &[u8; 32],
        user: i64,
        generation: i64,
        replace: bool,
    ) -> Result<(), CommandError> {
        self.apply_batch_mode(
            batch,
            key,
            user,
            replace.then_some(generation),
            false,
            Some(generation),
        )
    }
    pub fn apply_item(
        &self,
        tx: &Transaction<'_>,
        item: &Item,
        value: &Value,
    ) -> Result<(), CommandError> {
        let (table, columns) = columns(&item.item_type)?;
        if item.deleted {
            if item.item_type == "profile" {
                let refs:i64=tx.query_row("SELECT count(*) FROM profiles WHERE id!=?1 AND json_extract(options,'$.proxy.type')='jump' AND json_extract(options,'$.proxy.jump_profile_id')=?1",[&item.item_id],|r|r.get(0)).map_err(CommandError::database)?;
                if refs > 0 {
                    return Err(CommandError::new("SYNC_DEPENDENCY", "跳板服务器仍被引用"));
                }
            }
            let refs:i64=match item.item_type.as_str(){"group"=>tx.query_row("SELECT (SELECT count(*) FROM profiles WHERE group_id=?1)+(SELECT count(*) FROM groups WHERE parent_id=?1)",[&item.item_id],|r|r.get(0)),"vault"=>tx.query_row("SELECT count(*) FROM profiles WHERE vault_id=?1",[&item.item_id],|r|r.get(0)),_=>Ok(0)}.map_err(CommandError::database)?;
            if refs > 0 {
                return Err(CommandError::new("SYNC_DEPENDENCY", "条目仍被引用"));
            }
            tx.execute(&format!("DELETE FROM {table} WHERE id=?1"), [&item.item_id])
                .map_err(CommandError::database)?;
            return Ok(());
        }
        let mut row = SensitiveJson(value.clone());
        if row.0["options"].is_object() {
            row.0["options"] = Value::String(row.0["options"].to_string());
        }
        for field in match item.item_type.as_str() {
            "vault" => &["data"][..],
            "profile" => &["inline_credential", "proxy_credential"][..],
            _ => &[][..],
        } {
            if let Some(secret) = row.0[*field].as_str().filter(|s| !s.is_empty()) {
                let encrypted = self
                    .encryptor
                    .encrypt(secret)
                    .map_err(CommandError::database)?;
                if let Value::String(original) = &mut row.0[*field] {
                    original.zeroize();
                }
                row.0[*field] = Value::String(encrypted);
            }
        }
        for (field, kind) in [
            ("group_id", "groups"),
            ("vault_id", "vault"),
            ("parent_id", "groups"),
        ] {
            if let Some(id) = row.0[field].as_str().filter(|s| !s.is_empty()) {
                let exists: bool = tx
                    .query_row(
                        &format!("SELECT EXISTS(SELECT 1 FROM {kind} WHERE id=?1)"),
                        [id],
                        |r| r.get(0),
                    )
                    .map_err(CommandError::database)?;
                if !exists {
                    return Err(CommandError::new("SYNC_DEPENDENCY", "关联条目尚未就绪"));
                }
            }
        }
        if item.item_type == "group" {
            let mut next = row.0["parent_id"].as_str().unwrap_or("").to_owned();
            let mut seen = std::collections::HashSet::new();
            seen.insert(item.item_id.clone());
            while !next.is_empty() {
                if !seen.insert(next.clone()) {
                    return Err(CommandError::new("SYNC_DEPENDENCY", "分组循环引用"));
                }
                next = tx
                    .query_row(
                        "SELECT COALESCE(parent_id,'') FROM groups WHERE id=?1",
                        [next],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(CommandError::database)?
                    .unwrap_or_default();
            }
        }
        if item.item_type == "profile" {
            let mut options: Value =
                serde_json::from_str(row.0["options"].as_str().unwrap_or("{}"))
                    .map_err(CommandError::database)?;
            if let Some(object) = options.as_object_mut() {
                object.remove("host_key_fingerprint");
            }
            let mut next = options["proxy"]["jump_profile_id"]
                .as_str()
                .unwrap_or("")
                .to_owned();
            let mut seen = std::collections::HashSet::new();
            seen.insert(item.item_id.clone());
            while !next.is_empty() {
                if !seen.insert(next.clone()) {
                    return Err(CommandError::new("SYNC_DEPENDENCY", "跳板连接循环引用"));
                }
                let target: Option<String> = tx
                    .query_row("SELECT options FROM profiles WHERE id=?1", [&next], |r| {
                        r.get(0)
                    })
                    .optional()
                    .map_err(CommandError::database)?;
                let Some(target) = target else {
                    return Err(CommandError::new("SYNC_DEPENDENCY", "跳板服务器尚未就绪"));
                };
                let parsed: Value =
                    serde_json::from_str(&target).map_err(CommandError::database)?;
                next = parsed["proxy"]["jump_profile_id"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned();
            }
            row.0["options"] = Value::String(options.to_string());
        }
        if item.item_type == "profile" {
            let old: Option<String> = tx
                .query_row(
                    "SELECT options FROM profiles WHERE id=?1",
                    [&item.item_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(CommandError::database)?;
            if let Some(old) = old {
                let old: Value = serde_json::from_str(&old).unwrap_or_default();
                if let Some(fp) = old.get("host_key_fingerprint") {
                    let mut options: Value =
                        serde_json::from_str(row.0["options"].as_str().unwrap_or("{}"))
                            .map_err(CommandError::database)?;
                    options["host_key_fingerprint"] = fp.clone();
                    row.0["options"] = Value::String(
                        serde_json::to_string(&options).map_err(CommandError::database)?,
                    );
                }
            }
        }
        let fields: Vec<&str> = columns.split_whitespace().collect();
        let params: Vec<rusqlite::types::Value> = fields
            .iter()
            .map(|f| match &row.0[*f] {
                Value::Null => rusqlite::types::Value::Null,
                Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                Value::Bool(b) => rusqlite::types::Value::Integer(i64::from(*b)),
                v => rusqlite::types::Value::Text(v.to_string()),
            })
            .collect();
        let assignments = fields
            .iter()
            .filter(|f| **f != "id")
            .map(|f| format!("{f}=excluded.{f}"))
            .collect::<Vec<_>>()
            .join(",");
        tx.execute(
            &format!(
                "INSERT INTO {table}({}) VALUES({}) ON CONFLICT(id) DO UPDATE SET {assignments}",
                fields.join(","),
                vec!["?"; fields.len()].join(",")
            ),
            rusqlite::params_from_iter(params),
        )
        .map_err(CommandError::database)?;
        Ok(())
    }
    pub fn conflicts(&self) -> Result<Vec<Conflict>, CommandError> {
        let c = self.database.connect()?;
        let mut stmt=c.prepare("SELECT item_type,item_id,remote,reason FROM realtime_conflicts ORDER BY item_type,item_id").map_err(CommandError::database)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(CommandError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)?;
        let key = self.key()?;
        let (epoch, user): (i64, i64) = c
            .query_row(
                "SELECT epoch,COALESCE(user_id,0) FROM realtime_state WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(CommandError::database)?;
        rows.into_iter().map(|(kind,id,remote,reason)| {
            let remote:Item = serde_json::from_str(&remote).map_err(CommandError::database)?;
            let queued:Option<(bool,String)> = c.query_row("SELECT deleted,payload FROM realtime_outbox WHERE item_type=?1 AND item_id=?2 ORDER BY id DESC LIMIT 1",params![kind,id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(CommandError::database)?;
            let local = if let Some((deleted,payload)) = &queued { if *deleted { Value::Null } else { safe_summary(&self.portable(payload,&kind)?.0,&kind) } }
            else {
                let (table,cols) = columns(&kind)?;
                let obj = cols.split_whitespace().map(|f|format!("'{f}',{f}")).collect::<Vec<_>>().join(",");
                let raw:Option<String> = c.query_row(&format!("SELECT json_object({obj}) FROM {table} WHERE id=?1"),[&id],|r|r.get(0)).optional().map_err(CommandError::database)?;
                raw.map(|raw| { let raw=Zeroizing::new(raw); let body=SensitiveJson(serde_json::from_str(&raw).map_err(CommandError::database)?);Ok::<_,CommandError>(safe_summary(&body.0,&kind)) }).transpose()?.unwrap_or(Value::Null)
            };
            let remote_summary = if let Some(key) = &key {
                if user>0 && !remote.deleted {
                    let plain=crypto::open(key,&remote.payload,&crypto::aad(user,&kind,&id,remote.revision,remote.epoch.unwrap_or(epoch),remote.deleted)?)?;
                    let body=SensitiveJson(serde_json::from_slice(&plain).map_err(CommandError::database)?);
                    safe_summary(&body.0,&kind)
                } else { Value::Null }
            } else { Value::Null };
            let name=local["name"].as_str().or_else(||remote_summary["name"].as_str()).unwrap_or_default().to_owned();
            Ok(Conflict{item_type:kind,item_id:id,name,reason,remote_revision:remote.revision,local_deleted:local.is_null(),remote_deleted:remote.deleted,local,remote:remote_summary})
        }).collect()
    }

    pub fn resolve(
        &self,
        kind: &str,
        id: &str,
        choice: &str,
        expected_revision: Option<i64>,
        key: &[u8; 32],
        user: i64,
    ) -> Result<(), CommandError> {
        let mut c = self.database.connect()?;
        c.query_row("SELECT eizhu_capture_enabled(0)", [], |_| Ok(()))
            .map_err(CommandError::database)?;
        let tx = c.transaction().map_err(CommandError::database)?;
        let raw: String = tx
            .query_row(
                "SELECT remote FROM realtime_conflicts WHERE item_type=?1 AND item_id=?2",
                params![kind, id],
                |r| r.get(0),
            )
            .map_err(CommandError::database)?;
        let item: Item = serde_json::from_str(&raw).map_err(CommandError::database)?;
        if expected_revision.is_some_and(|expected| expected != item.revision) {
            return Err(CommandError::new(
                "CONFLICT_CHANGED",
                "云端内容再次变化，请重新选择",
            ));
        }
        let epoch = self.state()?.1;
        if choice == "use_cloud" {
            let plain = crypto::open(
                key,
                &item.payload,
                &crypto::aad(
                    user,
                    kind,
                    id,
                    item.revision,
                    item.epoch.unwrap_or(epoch),
                    item.deleted,
                )?,
            )?;
            let value =
                SensitiveJson(serde_json::from_slice(&plain).map_err(CommandError::database)?);
            self.apply_item(&tx, &item, &value.0)?;
            tx.execute(
                "DELETE FROM realtime_outbox WHERE item_type=?1 AND item_id=?2",
                params![kind, id],
            )
            .map_err(CommandError::database)?;
        } else if choice == "keep_local" {
            let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM realtime_outbox WHERE item_type=?1 AND item_id=?2)",params![kind,id],|r|r.get(0)).map_err(CommandError::database)?;
            if !pending {
                let (table, cols) = columns(kind)?;
                let obj = cols
                    .split_whitespace()
                    .map(|f| format!("'{f}',{f}"))
                    .collect::<Vec<_>>()
                    .join(",");
                let raw: Option<String> = tx
                    .query_row(
                        &format!("SELECT json_object({obj}) FROM {table} WHERE id=?1"),
                        [id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(CommandError::database)?;
                let deleted = raw.is_none();
                let raw =
                    Zeroizing::new(raw.unwrap_or_else(|| serde_json::json!({"id":id}).to_string()));
                let encrypted = self
                    .encryptor
                    .encrypt(&raw)
                    .map_err(CommandError::database)?;
                tx.execute(
                    "UPDATE realtime_state SET next_generation=next_generation+1 WHERE id=1",
                    [],
                )
                .map_err(CommandError::database)?;
                tx.execute("INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES(eizhu_batch(),?1,?2,(SELECT next_generation FROM realtime_state WHERE id=1),?3,?4)",params![kind,id,deleted,encrypted]).map_err(CommandError::database)?;
            }
        } else {
            return Err(CommandError::new("INVALID_CHOICE", "请选择本地或云端"));
        }
        set_revision(&tx, &item)?;
        tx.execute(
            "DELETE FROM realtime_conflicts WHERE item_type=?1 AND item_id=?2",
            params![kind, id],
        )
        .map_err(CommandError::database)?;
        tx.commit().map_err(CommandError::database)
    }
    pub fn save_safety(&self, c: &rusqlite::Connection) -> Result<(), CommandError> {
        let mut dump = SensitiveJson(serde_json::json!({}));
        for table in [
            "groups",
            "vault",
            "profiles",
            "snippets",
            "realtime_outbox",
            "realtime_items",
            "realtime_conflicts",
            "realtime_requests",
            "realtime_state",
        ] {
            let mut statement = c
                .prepare(&format!("SELECT * FROM {table}"))
                .map_err(CommandError::database)?;
            let names = statement
                .column_names()
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let rows = statement
                .query_map([], |r| {
                    let mut row = serde_json::Map::new();
                    for (n, name) in names.iter().enumerate() {
                        let v = match r.get_ref(n)? {
                            rusqlite::types::ValueRef::Null => Value::Null,
                            rusqlite::types::ValueRef::Integer(n) => Value::from(n),
                            rusqlite::types::ValueRef::Real(n) => Value::from(n),
                            rusqlite::types::ValueRef::Text(b) => {
                                Value::String(String::from_utf8_lossy(b).into_owned())
                            }
                            rusqlite::types::ValueRef::Blob(_) => {
                                return Err(rusqlite::Error::InvalidQuery)
                            }
                        };
                        row.insert(name.clone(), v);
                    }
                    Ok(Value::Object(row))
                })
                .map_err(CommandError::database)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(CommandError::database)?;
            dump.0[table] = Value::Array(rows);
        }
        let raw = Zeroizing::new(serde_json::to_string(&dump.0).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&raw)
            .map_err(CommandError::database)?;
        c.execute_batch("CREATE TABLE IF NOT EXISTS realtime_safety(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").map_err(CommandError::database)?;
        c.execute(
            "INSERT INTO realtime_safety(id,payload) VALUES(?1,?2)",
            params![uuid::Uuid::new_v4().to_string(), encrypted],
        )
        .map_err(CommandError::database)?;
        Ok(())
    }
    fn seed_on(c: &rusqlite::Connection) -> Result<(), CommandError> {
        for kind in ["group", "vault", "profile", "snippet"] {
            let (table, cols) = columns(kind)?;
            let fields: Vec<&str> = cols.split_whitespace().collect();
            let obj = fields
                .iter()
                .map(|f| {
                    if *f == "options" {
                        "'options',json_remove(options,'$.host_key_fingerprint')".into()
                    } else {
                        format!("'{f}',{f}")
                    }
                })
                .collect::<Vec<_>>()
                .join(",");
            c.execute(&format!("INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) SELECT eizhu_batch(),?1,id,(SELECT next_generation FROM realtime_state WHERE id=1),0,eizhu_encrypt_change(json_object({obj})) FROM {table} WHERE NOT EXISTS(SELECT 1 FROM realtime_outbox WHERE item_type=?1 AND item_id={table}.id)"),[kind]).map_err(CommandError::database)?;
        }
        Ok(())
    }

    fn check_generation(c: &rusqlite::Connection, expected: i64) -> Result<(), CommandError> {
        let generation: i64 = c
            .query_row(
                "SELECT next_generation FROM realtime_state WHERE id=1",
                [],
                |r| r.get(0),
            )
            .map_err(CommandError::database)?;
        if generation != expected {
            return Err(CommandError::new(
                "PREVIEW_CHANGED",
                "本地数据已变化，请重新预览",
            ));
        }
        Ok(())
    }

    pub fn prepare_local_replace(
        &self,
        batch: &Batch,
        generation: i64,
        key: &[u8; 32],
        user: i64,
        device: &str,
    ) -> Result<(), CommandError> {
        let mut c = self.database.connect()?;
        let tx = c
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(CommandError::database)?;
        Self::check_generation(&tx, generation)?;
        self.save_safety(&tx)?;
        Self::seed_on(&tx)?;
        tx.execute("DELETE FROM realtime_conflicts", [])
            .map_err(CommandError::database)?;
        for item in &batch.items {
            set_revision(&tx, item)?;
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM realtime_outbox WHERE item_type=?1 AND item_id=?2)", params![item.item_type,item.item_id], |r| r.get(0)).map_err(CommandError::database)?;
            if !exists {
                let encrypted = self
                    .encryptor
                    .encrypt(&serde_json::json!({"id":item.item_id}).to_string())
                    .map_err(CommandError::database)?;
                tx.execute("INSERT INTO realtime_outbox(batch_id,item_type,item_id,generation,deleted,payload) VALUES('bootstrap',?1,?2,?3,1,?4)", params![item.item_type,item.item_id,generation,encrypted]).map_err(CommandError::database)?;
            }
        }
        tx.execute("UPDATE realtime_outbox SET batch_id='bootstrap'", [])
            .map_err(CommandError::database)?;
        tx.execute("UPDATE realtime_state SET epoch=?1,cursor=?2,initialized=1,status='pending',user_id=?3 WHERE id=1", params![batch.epoch,batch.seq,user]).map_err(CommandError::database)?;
        let (push, ids) = self.build_push_on(&tx, key, user, device, true)?;
        Self::freeze_on(&tx, &push, &ids)?;
        tx.commit().map_err(CommandError::database)
    }

    pub fn freeze_pending(
        &self,
        key: &[u8; 32],
        user: i64,
        device: &str,
    ) -> Result<Option<(Push, Vec<i64>)>, CommandError> {
        let mut c = self.database.connect()?;
        let tx = c
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(CommandError::database)?;
        if self.pending_on(&tx)?.is_empty() {
            return Ok(None);
        }
        let (push, ids) = self.build_push_on(&tx, key, user, device, false)?;
        Self::freeze_on(&tx, &push, &ids)?;
        tx.commit().map_err(CommandError::database)?;
        Ok(Some((push, ids)))
    }

    fn build_push_on(
        &self,
        c: &rusqlite::Connection,
        key: &[u8; 32],
        user: i64,
        device: &str,
        replace: bool,
    ) -> Result<(Push, Vec<i64>), CommandError> {
        let pending = self.pending_on(c)?;
        debug_assert!(pending
            .first()
            .is_none_or(|first| pending.iter().all(|p| p.batch == first.batch)));
        let ids = pending.iter().map(|p| p.id).collect::<Vec<_>>();
        let mut latest = std::collections::HashMap::new();
        for p in pending {
            latest.insert((p.kind.clone(), p.item_id.clone()), p);
        }
        let (cursor, epoch): (i64, i64) = c
            .query_row(
                "SELECT cursor,epoch FROM realtime_state WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(CommandError::database)?;
        let mut items = Vec::new();
        for p in latest.into_values() {
            let base = Self::revision_on(c, &p.kind, &p.item_id)?;
            let portable = self.portable(&p.payload, &p.kind)?;
            let raw =
                Zeroizing::new(serde_json::to_vec(&portable.0).map_err(CommandError::database)?);
            let target_epoch = epoch + i64::from(replace);
            let payload = crypto::seal(
                key,
                &raw,
                &crypto::aad(user, &p.kind, &p.item_id, base + 1, target_epoch, p.deleted)?,
            )?;
            items.push(Item {
                item_type: p.kind,
                item_id: p.item_id,
                base_revision: base,
                revision: base + 1,
                generation: p.generation,
                deleted: p.deleted,
                payload,
                key_version: 1,
                epoch: replace.then_some(target_epoch),
            });
        }
        items.sort_by(|a, b| (&a.item_type, &a.item_id).cmp(&(&b.item_type, &b.item_id)));
        Ok((
            Push {
                request_id: uuid::Uuid::new_v4().to_string(),
                device_id: device.into(),
                epoch,
                replace,
                expected_seq: Some(cursor),
                items,
            },
            ids,
        ))
    }
}
fn columns(kind: &str) -> Result<(&'static str, &'static str), CommandError> {
    match kind{"group"=>Ok(("groups","id name parent_id icon sort_order created_at")),"vault"=>Ok(("vault","id type data fingerprint name username remark created_at updated_at")),"profile"=>Ok(("profiles","id name host port username auth_type icon vault_id group_id tags options note sort_order created_at updated_at inline_credential proxy_credential")),"snippet"=>Ok(("snippets","id name content description tags is_global created_at updated_at")),_=>Err(CommandError::new("SYNC_CONTENT","未知条目类型"))}
}
fn set_revision(tx: &Transaction<'_>, item: &Item) -> Result<(), CommandError> {
    tx.execute(
        "DELETE FROM realtime_conflicts WHERE item_type=?1 AND item_id=?2",
        params![item.item_type, item.item_id],
    )
    .map_err(CommandError::database)?;
    tx.execute("INSERT INTO realtime_items(item_type,item_id,revision,generation) VALUES(?1,?2,?3,0) ON CONFLICT(item_type,item_id) DO UPDATE SET revision=excluded.revision",params![item.item_type,item.item_id,item.revision]).map_err(CommandError::database)?;
    Ok(())
}
fn save_conflict(
    tx: &Transaction<'_>,
    item: &Item,
    reason: &str,
    epoch: i64,
) -> Result<(), CommandError> {
    let mut item = item.clone();
    item.epoch = Some(item.epoch.unwrap_or(epoch));
    tx.execute("INSERT INTO realtime_conflicts(item_type,item_id,remote,reason) VALUES(?1,?2,?3,?4) ON CONFLICT(item_type,item_id) DO UPDATE SET remote=excluded.remote,reason=excluded.reason",params![item.item_type,item.item_id,serde_json::to_string(&item).map_err(CommandError::database)?,reason]).map_err(CommandError::database)?;
    Ok(())
}
fn safe_summary(value: &Value, kind: &str) -> Value {
    let fields: &[&str] = match kind {
        "group" => &["name", "parent_id", "icon", "sort_order"],
        "vault" => &["name", "type", "username", "remark", "fingerprint"],
        "profile" => &[
            "name",
            "host",
            "port",
            "username",
            "auth_type",
            "group_id",
            "vault_id",
            "tags",
            "note",
        ],
        "snippet" => &["name", "content", "description", "tags", "is_global"],
        _ => &[],
    };
    Value::Object(
        fields
            .iter()
            .filter_map(|f| value.get(*f).map(|v| ((*f).to_owned(), v.clone())))
            .collect(),
    )
}

fn equivalent(a: &Value, b: &Value) -> bool {
    let mut a = a.clone();
    let mut b = b.clone();
    for v in [&mut a, &mut b] {
        if let Some(o) = v.as_object_mut() {
            o.remove("updated_at");
            o.remove("created_at");
        }
    }
    let result = a == b;
    drop(SensitiveJson(a));
    drop(SensitiveJson(b));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn repository() -> (tempfile::TempDir, SyncRepository) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::initialize(dir.path().join("db")).unwrap();
        let key = Encryptor::load_or_create(dir.path().join("key")).unwrap();
        let capture = key.clone();
        db.configure_capture(move |v| capture.encrypt(v).map_err(|e| e.to_string()));
        (dir, SyncRepository::new(db, key))
    }
    fn group(id: &str, name: &str, parent: Option<&str>) -> Value {
        json!({"id":id,"name":name,"parent_id":parent,"icon":"folder","sort_order":0,"created_at":"2026-10-01"})
    }
    fn remote(value: Value, revision: i64, deleted: bool) -> Item {
        let id = value["id"].as_str().unwrap().to_owned();
        let payload = crypto::seal(
            &[4; 32],
            &serde_json::to_vec(&value).unwrap(),
            &crypto::aad(1, "group", &id, revision, 1, deleted).unwrap(),
        )
        .unwrap();
        Item {
            item_type: "group".into(),
            item_id: id,
            base_revision: revision - 1,
            revision,
            generation: 1,
            deleted,
            payload,
            key_version: 1,
            epoch: None,
        }
    }
    fn batch(items: Vec<Item>, seq: i64) -> Batch {
        Batch {
            request_id: format!("remote-{seq}"),
            seq,
            epoch: 1,
            items,
        }
    }
    fn insert(repo: &SyncRepository, id: &str, name: &str) {
        repo.database
            .connect()
            .unwrap()
            .execute(
                "INSERT INTO groups(id,name) VALUES(?1,?2)",
                params![id, name],
            )
            .unwrap();
    }
    #[test]
    fn pending_dependencies_preserve_transaction_order_when_parent_is_edited_again() {
        let (_dir, r) = repository();
        let mut c = r.database.connect().unwrap();
        let tx = c.transaction().unwrap();
        tx.execute("INSERT INTO groups(id,name) VALUES('parent','first')", [])
            .unwrap();
        tx.execute(
            "INSERT INTO groups(id,name,parent_id) VALUES('child','child','parent')",
            [],
        )
        .unwrap();
        tx.commit().unwrap();
        c.execute("UPDATE groups SET name='latest' WHERE id='parent'", [])
            .unwrap();
        let first = r.pending().unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].batch, first[1].batch);
        assert_eq!(
            r.portable(&first[0].payload, "group").unwrap().0["name"],
            "first"
        );
        let (push, ids) = r.freeze_pending(&[4; 32], 1, "device").unwrap().unwrap();
        r.ack(&push, &ids).unwrap();
        let later = r.pending().unwrap();
        assert_eq!(later.len(), 1);
        assert_eq!(
            r.portable(&later[0].payload, "group").unwrap().0["name"],
            "latest"
        );
    }

    #[test]
    fn persisted_dependency_recovers_when_parent_arrives_without_feedback() {
        let (_dir, r) = repository();
        r.apply_batch(
            &batch(
                vec![remote(group("child", "child", Some("parent")), 1, false)],
                1,
            ),
            &[4; 32],
            1,
        )
        .unwrap();
        assert_eq!(r.status().unwrap().conflict_count, 1);
        assert_eq!(r.state().unwrap().0, 1);
        r.apply_batch(
            &batch(vec![remote(group("parent", "parent", None), 1, false)], 2),
            &[4; 32],
            1,
        )
        .unwrap();
        assert_eq!(r.status().unwrap().conflict_count, 0);
        assert_eq!(r.revision("group", "child").unwrap(), 1);
        assert!(r.pending().unwrap().is_empty());
        let parent: String = r
            .database
            .connect()
            .unwrap()
            .query_row("SELECT parent_id FROM groups WHERE id='child'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(parent, "parent");
    }

    #[test]
    fn unsupported_key_version_rolls_back_changes_and_cursor() {
        let (_dir, r) = repository();
        let mut unsupported = remote(group("second", "unsupported", None), 1, false);
        unsupported.key_version = 2;
        let error = r
            .apply_batch(
                &batch(
                    vec![remote(group("first", "valid", None), 1, false), unsupported],
                    1,
                ),
                &[4; 32],
                1,
            )
            .unwrap_err();
        assert_eq!(error.code, "SYNC_PROTOCOL");
        assert_eq!(r.state().unwrap().0, 0);
        assert_eq!(r.revision("group", "first").unwrap(), 0);
    }

    #[test]
    fn remote_jump_deletion_waits_for_referencing_profile_deletion() {
        let (_dir, r) = repository();
        let c = r.database.connect().unwrap();
        c.query_row("SELECT eizhu_capture_enabled(0)", [], |_| Ok(()))
            .unwrap();
        c.execute(
            "INSERT INTO profiles(id,name,host,options) VALUES('jump','jump','localhost','{}')",
            [],
        )
        .unwrap();
        c.execute("INSERT INTO profiles(id,name,host,options) VALUES('dependent','dependent','localhost',?1)", [json!({"proxy":{"type":"jump","jump_profile_id":"jump"}}).to_string()]).unwrap();
        let tombstone = |id: &str| Item {
            item_type: "profile".into(),
            item_id: id.into(),
            base_revision: 0,
            revision: 1,
            generation: 1,
            deleted: true,
            key_version: 1,
            epoch: None,
            payload: crypto::seal(
                &[4; 32],
                &serde_json::to_vec(&json!({"id":id})).unwrap(),
                &crypto::aad(1, "profile", id, 1, 1, true).unwrap(),
            )
            .unwrap(),
        };
        r.apply_batch(&batch(vec![tombstone("jump")], 1), &[4; 32], 1)
            .unwrap();
        assert_eq!(r.status().unwrap().conflict_count, 1);
        let count: i64 = c
            .query_row("SELECT count(*) FROM profiles WHERE id='jump'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        r.apply_batch(&batch(vec![tombstone("dependent")], 2), &[4; 32], 1)
            .unwrap();
        assert_eq!(r.status().unwrap().conflict_count, 0);
        let count: i64 = c
            .query_row("SELECT count(*) FROM profiles", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(r.pending().unwrap().is_empty());
    }

    #[test]
    fn conflict_preview_exposes_both_business_summaries_without_credentials() {
        let (_dir, r) = repository();
        let c = r.database.connect().unwrap();
        c.execute("UPDATE realtime_state SET user_id=1 WHERE id=1", [])
            .unwrap();
        let local = r.encryptor.encrypt("local-password").unwrap();
        c.execute("INSERT INTO vault(id,type,data,name) VALUES('credential','password',?1,'local credential')",[local]).unwrap();
        let value = serde_json::json!({"id":"credential","name":"remote credential","type":"password","data":"remote-password","username":"root","remark":"","fingerprint":"","created_at":"2026-10-01","updated_at":"2026-10-01"});
        let item = Item {
            item_type: "vault".into(),
            item_id: "credential".into(),
            base_revision: 0,
            revision: 1,
            generation: 1,
            deleted: false,
            payload: crypto::seal(
                &[4; 32],
                &serde_json::to_vec(&value).unwrap(),
                &crypto::aad(1, "vault", "credential", 1, 1, false).unwrap(),
            )
            .unwrap(),
            key_version: 1,
            epoch: None,
        };
        r.apply_batch(&batch(vec![item], 1), &[4; 32], 1).unwrap();
        let envelope = crypto::KeyEnvelope {
            salt: String::new(),
            time: 3,
            memory: 65536,
            threads: 2,
            wrapped_key: String::new(),
            version: 1,
            revision: 1,
        };
        r.save_key(&[4; 32], &envelope, "password").unwrap();
        let conflicts = r.conflicts().unwrap();
        assert_eq!(conflicts[0].local["name"], "local credential");
        assert_eq!(conflicts[0].remote["name"], "remote credential");
        let response = serde_json::to_string(&conflicts).unwrap();
        assert!(!response.contains("local-password"));
        assert!(!response.contains("remote-password"));
    }
    #[test]
    fn initial_replacement_is_atomic_and_rejects_edits_after_preview() {
        let (_dir, r) = repository();
        insert(&r, "local", "first");
        let initial = batch(vec![remote(group("cloud", "remote", None), 1, false)], 1);
        assert_eq!(
            r.prepare_local_replace(&initial, 0, &[4; 32], 1, "device")
                .unwrap_err()
                .code,
            "PREVIEW_CHANGED"
        );
        assert!(r.frozen().unwrap().is_none());
        assert_eq!(r.state().unwrap(), (0, 1, false));
        r.prepare_local_replace(&initial, 1, &[4; 32], 1, "device")
            .unwrap();
        let (push, ids) = r.frozen().unwrap().unwrap();
        assert!(push.replace);
        assert_eq!(push.expected_seq, Some(1));
        assert_eq!(push.items.len(), 2);
        let tombstone = push.items.iter().find(|i| i.item_id == "cloud").unwrap();
        assert!(tombstone.deleted);
        crypto::open(
            &[4; 32],
            &tombstone.payload,
            &crypto::aad(1, "group", "cloud", 2, 2, true).unwrap(),
        )
        .unwrap();
        insert(&r, "later", "created while uploading");
        r.ack(&push, &ids).unwrap();
        assert_eq!(r.state().unwrap(), (1, 2, true));
        assert_eq!(r.pending().unwrap()[0].item_id, "later");
    }

    #[test]
    fn conflicts_block_referencing_batches_but_allow_unrelated_changes() {
        let (_dir, r) = repository();
        insert(&r, "parent", "local");
        r.apply_batch(
            &batch(vec![remote(group("parent", "remote", None), 1, false)], 1),
            &[4; 32],
            1,
        )
        .unwrap();
        r.database
            .connect()
            .unwrap()
            .execute(
                "INSERT INTO groups(id,name,parent_id) VALUES('child','dependent','parent')",
                [],
            )
            .unwrap();
        insert(&r, "unrelated", "continues");
        assert_eq!(r.pending().unwrap()[0].item_id, "unrelated");
    }

    #[test]
    fn invalid_cloud_initialization_rolls_back_seed_and_initialization() {
        let (_dir, r) = repository();
        insert(&r, "local", "private");
        let initial = batch(vec![remote(group("cloud", "remote", None), 1, false)], 1);
        assert!(r.apply_initial(&initial, &[9; 32], 1, 1, false).is_err());
        assert_eq!(r.state().unwrap(), (0, 1, false));
        assert_eq!(r.status().unwrap().pending_count, 1);
        let count: i64 = r
            .database
            .connect()
            .unwrap()
            .query_row("SELECT count(*) FROM groups WHERE id='cloud'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn local_mutations_and_encrypted_queue_commit_and_rollback_together() {
        let (_dir, r) = repository();
        let mut c = r.database.connect().unwrap();
        {
            let tx = c.transaction().unwrap();
            tx.execute("INSERT INTO groups(id,name) VALUES('a','private name')", [])
                .unwrap();
            tx.execute("INSERT INTO groups(id,name) VALUES('b','second')", [])
                .unwrap();
            tx.commit().unwrap();
        }
        let pending = r.pending().unwrap();
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].batch, pending[1].batch);
        assert!(!pending[0].payload.contains("private name"));
        assert_eq!(
            r.portable(&pending[0].payload, "group").unwrap().0["name"],
            "private name"
        );
        {
            let tx = c.transaction().unwrap();
            tx.execute("DELETE FROM groups", []).unwrap();
        }
        assert_eq!(r.status().unwrap().pending_count, 2);
        c.execute("DELETE FROM groups WHERE id='a'", []).unwrap();
        let count: i64 = c
            .query_row(
                "SELECT count(*) FROM realtime_outbox WHERE deleted=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let reopened = Database::initialize(_dir.path().join("db")).unwrap();
        let restored = SyncRepository::new(reopened, r.encryptor.clone());
        assert_eq!(restored.status().unwrap().pending_count, 2);
    }
    #[test]
    fn failed_encryption_rolls_back_business_write() {
        let (_dir, r) = repository();
        r.database.configure_capture(|_| Err("unavailable".into()));
        assert!(r
            .database
            .connect()
            .unwrap()
            .execute("INSERT INTO groups(id,name) VALUES('a','secret')", [])
            .is_err());
        let count: i64 = r
            .database
            .connect()
            .unwrap()
            .query_row("SELECT count(*) FROM groups", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
    #[test]
    fn frozen_request_is_stable_and_old_confirmation_preserves_new_edit() {
        let (_dir, r) = repository();
        insert(&r, "a", "first");
        let pending = r.pending().unwrap();
        let ids = pending.iter().map(|p| p.id).collect::<Vec<_>>();
        let push = Push {
            request_id: uuid::Uuid::new_v4().to_string(),
            device_id: uuid::Uuid::new_v4().to_string(),
            epoch: 1,
            replace: false,
            expected_seq: Some(0),
            items: vec![remote(group("a", "first", None), 1, false)],
        };
        r.freeze(&push, &ids).unwrap();
        r.database
            .connect()
            .unwrap()
            .execute("UPDATE groups SET name='second' WHERE id='a'", [])
            .unwrap();
        assert_eq!(
            serde_json::to_string(&r.frozen().unwrap().unwrap().0).unwrap(),
            serde_json::to_string(&push).unwrap()
        );
        r.ack(&push, &ids).unwrap();
        r.ack(&push, &ids).unwrap();
        let next = r.pending().unwrap();
        assert_eq!(next.len(), 1);
        assert_eq!(
            r.portable(&next[0].payload, "group").unwrap().0["name"],
            "second"
        );
        assert_eq!(r.revision("group", "a").unwrap(), 1);
    }
    #[test]
    fn remote_edit_preserves_local_and_unrelated_items_continue() {
        let (_dir, r) = repository();
        insert(&r, "a", "local");
        insert(&r, "b", "independent");
        r.apply_batch(
            &batch(
                vec![
                    remote(group("a", "remote", None), 1, false),
                    remote(group("c", "third", None), 1, false),
                ],
                1,
            ),
            &[4; 32],
            1,
        )
        .unwrap();
        assert_eq!(r.conflicts().unwrap().len(), 1);
        assert_eq!(r.pending().unwrap()[0].item_id, "b");
        let c = r.database.connect().unwrap();
        let local: String = c
            .query_row("SELECT name FROM groups WHERE id='a'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(local, "local");
        assert_eq!(r.state().unwrap().0, 1);
        r.resolve("group", "a", "keep_local", None, &[4; 32], 1)
            .unwrap();
        assert_eq!(r.revision("group", "a").unwrap(), 1);
        assert_eq!(r.pending().unwrap()[0].item_id, "a");
    }
    #[test]
    fn equivalent_remote_content_confirms_without_conflict_or_feedback() {
        let (_dir, r) = repository();
        insert(&r, "a", "same");
        r.apply_batch(
            &batch(vec![remote(group("a", "same", None), 1, false)], 1),
            &[4; 32],
            1,
        )
        .unwrap();
        assert!(r.pending().unwrap().is_empty());
        assert!(r.conflicts().unwrap().is_empty());
    }
    #[test]
    fn dependencies_are_applied_in_order_and_tampering_does_not_advance_cursor() {
        let (_dir, r) = repository();
        r.apply_batch(
            &batch(
                vec![
                    remote(group("child", "child", Some("parent")), 1, false),
                    remote(group("parent", "parent", None), 1, false),
                ],
                1,
            ),
            &[4; 32],
            1,
        )
        .unwrap();
        assert!(r.conflicts().unwrap().is_empty());
        assert!(r.pending().unwrap().is_empty());
        let mut tampered = remote(group("parent", "changed", None), 2, false);
        tampered.deleted = true;
        assert!(r
            .apply_batch(&batch(vec![tampered], 2), &[4; 32], 1)
            .is_err());
        assert_eq!(r.state().unwrap().0, 1);
    }
    #[test]
    fn deleted_remote_conflicts_with_edit_and_use_cloud_removes_only_that_item() {
        let (_dir, r) = repository();
        insert(&r, "a", "local");
        insert(&r, "b", "other");
        r.apply_batch(
            &batch(vec![remote(group("a", "old", None), 1, true)], 1),
            &[4; 32],
            1,
        )
        .unwrap();
        assert!(r.conflicts().unwrap()[0].remote_deleted);
        r.resolve("group", "a", "use_cloud", None, &[4; 32], 1)
            .unwrap();
        assert_eq!(r.status().unwrap().pending_count, 1);
        assert_eq!(r.pending().unwrap()[0].item_id, "b");
    }
}
