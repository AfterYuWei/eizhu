use super::{repository::LocalStateRepository, HistoryEntry, HistorySettings, LocalStateKey};
use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};
use chrono::Utc;

#[derive(Clone)]
pub(crate) struct LocalStateService {
    repository: LocalStateRepository,
}

impl LocalStateService {
    pub fn new(database: Database, encryptor: Encryptor) -> Self {
        Self {
            repository: LocalStateRepository::new(database, encryptor),
        }
    }
    pub fn read(&self, key: LocalStateKey) -> Result<Option<serde_json::Value>, CommandError> {
        self.repository.read(key)
    }
    pub fn write(&self, key: LocalStateKey, value: serde_json::Value) -> Result<(), CommandError> {
        if serde_json::to_vec(&value)
            .map_err(CommandError::database)?
            .len()
            > 65536
        {
            return Err(CommandError::new("VALIDATION", "本地设置过大"));
        }
        if matches!(key, LocalStateKey::HistorySettings) {
            let settings: HistorySettings =
                serde_json::from_value(value.clone()).map_err(CommandError::database)?;
            if !(1..=5000).contains(&settings.max_entries)
                || !(1..=3650).contains(&settings.retention_days)
            {
                return Err(CommandError::new(
                    "VALIDATION",
                    "历史数量或保留天数超出范围",
                ));
            }
        }
        self.repository.write(key, &value)
    }
    fn settings(&self) -> Result<HistorySettings, CommandError> {
        self.read(LocalStateKey::HistorySettings)?
            .map(serde_json::from_value)
            .transpose()
            .map_err(CommandError::database)
            .map(|value| value.unwrap_or_default())
    }
    fn profile_exists(&self, profile_id: &str) -> Result<(), CommandError> {
        if !self.repository.profile_exists(profile_id)? {
            return Err(CommandError::new("NOT_FOUND", "服务器配置不存在"));
        }
        Ok(())
    }
    pub fn record(&self, profile_id: &str, command: &str, cwd: &str) -> Result<(), CommandError> {
        self.record_at(profile_id, command, cwd, Utc::now().timestamp_millis())
    }
    fn record_at(
        &self,
        profile_id: &str,
        command: &str,
        cwd: &str,
        now: i64,
    ) -> Result<(), CommandError> {
        let settings = self.settings()?;
        if !settings.enabled || command.starts_with(char::is_whitespace) || !valid_command(command)
        {
            return Ok(());
        }
        self.profile_exists(profile_id)?;
        if cwd.len() > 8192 || cwd.chars().any(char::is_control) {
            return Err(CommandError::new("VALIDATION", "工作目录无效"));
        }
        self.repository.mutate_history(profile_id, |entries| {
            if let Some(entry) = entries
                .iter_mut()
                .find(|e| e.command == command && e.cwd == cwd)
            {
                entry.count = entry.count.saturating_add(1);
                entry.last_at = now;
            } else {
                entries.push(HistoryEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    command: command.into(),
                    cwd: cwd.into(),
                    count: 1,
                    last_at: now,
                });
            }
            prune(entries, &settings, now);
            Ok(())
        })
    }
    pub fn list(&self, profile_id: &str) -> Result<Vec<HistoryEntry>, CommandError> {
        let settings = self.settings()?;
        self.repository.mutate_history(profile_id, |entries| {
            prune(entries, &settings, Utc::now().timestamp_millis());
            Ok(entries.clone())
        })
    }
    pub fn delete(&self, profile_id: Option<&str>, id: Option<&str>) -> Result<(), CommandError> {
        match profile_id {
            Some(profile) => self.repository.mutate_history(profile, |entries| {
                entries.retain(|e| id.is_some_and(|id| e.id != id));
                Ok(())
            }),
            None => self.repository.clear_history(),
        }
    }
    pub fn import(
        &self,
        profile_id: &str,
        imported: Vec<HistoryEntry>,
    ) -> Result<usize, CommandError> {
        self.profile_exists(profile_id)?;
        if imported.len() > 5000 {
            return Err(CommandError::new("VALIDATION", "历史导入数量过大"));
        }
        let settings = self.settings()?;
        let now = Utc::now().timestamp_millis();
        self.repository.mutate_history(profile_id, |entries| {
            let mut count = 0;
            for entry in imported {
                if !valid_command(&entry.command)
                    || entry.command.starts_with(char::is_whitespace)
                    || entry.cwd.len() > 8192
                    || entry.cwd.chars().any(char::is_control)
                {
                    continue;
                }
                if entries
                    .iter()
                    .any(|e| e.command == entry.command && e.cwd == entry.cwd)
                {
                    continue;
                }
                entries.push(HistoryEntry {
                    id: uuid::Uuid::new_v4().to_string(),
                    last_at: entry.last_at.min(now),
                    count: entry.count.max(1),
                    ..entry
                });
                count += 1;
            }
            prune(entries, &settings, now);
            Ok(count)
        })
    }
}

fn valid_command(command: &str) -> bool {
    !command.trim().is_empty() && command.len() <= 8192 && !command.chars().any(char::is_control)
}
fn prune(entries: &mut Vec<HistoryEntry>, settings: &HistorySettings, now: i64) {
    let cutoff = now.saturating_sub(i64::from(settings.retention_days) * 86400000);
    entries.retain(|e| e.last_at >= cutoff);
    entries.sort_by(|a, b| b.last_at.cmp(&a.last_at).then_with(|| a.id.cmp(&b.id)));
    entries.truncate(settings.max_entries);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, LocalStateService) {
        let dir = tempfile::tempdir().unwrap();
        let database = Database::initialize(dir.path().join("db")).unwrap();
        for id in ["a", "b"] {
            database
                .connect()
                .unwrap()
                .execute(
                    "INSERT INTO profiles(id,name,host) VALUES(?1,?1,'host')",
                    [id],
                )
                .unwrap();
        }
        let encryptor = Encryptor::load_or_create(dir.path().join("key")).unwrap();
        (dir, LocalStateService::new(database, encryptor))
    }
    #[test]
    fn history_is_encrypted_isolated_and_never_enters_the_outbox() {
        let (_dir, service) = setup();
        service
            .repository
            .database
            .configure_capture(|raw| Ok(raw.to_owned()));
        service
            .record("a", "echo local-private-value", "/private")
            .unwrap();
        assert!(service.list("b").unwrap().is_empty());
        let connection = service.repository.database.connect().unwrap();
        let stored: String = connection
            .query_row(
                "SELECT payload FROM local_history WHERE profile_id='a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!stored.contains("local-private-value"));
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM realtime_outbox", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        connection
            .execute("UPDATE profiles SET name='updated' WHERE id='a'", [])
            .unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM realtime_outbox", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        service.record("a", " echo skipped", "").unwrap();
        service.record("a", "multi\nline", "").unwrap();
        assert_eq!(service.list("a").unwrap().len(), 1);
    }
    #[test]
    fn disabled_recording_retention_dedup_and_clear_are_enforced() {
        let (_dir, service) = setup();
        service
            .write(
                LocalStateKey::HistorySettings,
                serde_json::json!({"enabled":false}),
            )
            .unwrap();
        service.record("a", "ignored", "").unwrap();
        assert!(service.list("a").unwrap().is_empty());
        service
            .write(
                LocalStateKey::HistorySettings,
                serde_json::json!({"maxEntries":2,"retentionDays":1}),
            )
            .unwrap();
        let now = Utc::now().timestamp_millis();
        service.record_at("a", "old", "", now - 86400001).unwrap();
        service.record_at("a", "one", "", now - 2).unwrap();
        service.record_at("a", "two", "", now - 1).unwrap();
        service.record_at("a", "two", "", now).unwrap();
        let list = service.list("a").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].count, 2);
        service.delete(Some("a"), Some(&list[0].id)).unwrap();
        assert_eq!(service.list("a").unwrap().len(), 1);
        service.delete(None, None).unwrap();
        assert!(service.list("a").unwrap().is_empty());
    }
    #[test]
    fn import_is_idempotent_and_local_migration_is_repeatable() {
        let (dir, service) = setup();
        let imported = HistoryEntry {
            id: "legacy".into(),
            command: "pwd".into(),
            cwd: "/".into(),
            count: 3,
            last_at: Utc::now().timestamp_millis(),
        };
        assert_eq!(service.import("a", vec![imported.clone()]).unwrap(), 1);
        assert_eq!(service.import("a", vec![imported]).unwrap(), 0);
        Database::initialize(dir.path().join("db")).unwrap();
        assert_eq!(service.list("a").unwrap()[0].count, 3);
        let (_other, other) = setup();
        assert!(other.list("a").unwrap().is_empty());
    }
}
