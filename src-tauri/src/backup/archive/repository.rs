use std::collections::HashMap;

use chrono::{Local, SecondsFormat};
use rusqlite::{params, OptionalExtension, Row};

use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};

use super::model::{
    BackupEvent, BackupSettings, BackupTargetConfig, BackupTargetMeta, BackupVersion,
};

const VERSION_COLUMNS: &str =
    "id,version,hash,size,file_path,origin,synced_to,created_at,password_revision";
const PROVIDER_COLUMNS: &str = "id,type,name,enabled,config,created_at,updated_at";

#[derive(Clone)]
pub struct ArchiveRepository {
    database: Database,
    encryptor: Encryptor,
}

pub struct SyncStateRow {
    pub status: String,
    pub last_sync_at: Option<String>,
    pub conflict_json: String,
}

#[derive(Clone)]
pub(super) struct ProviderRow {
    pub meta: BackupTargetMeta,
    pub config: BackupTargetConfig,
}

impl ArchiveRepository {
    pub fn new(database: Database, encryptor: Encryptor) -> Self {
        Self {
            database,
            encryptor,
        }
    }

    pub fn identity(&self) -> Result<(String, String), CommandError> {
        let connection = self.database.connect()?;
        connection
            .execute(
                "INSERT OR IGNORE INTO backup_identity(id,device_id,space_id) VALUES(1,?1,?2)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    uuid::Uuid::new_v4().to_string()
                ],
            )
            .map_err(CommandError::database)?;
        connection
            .query_row(
                "SELECT device_id,space_id FROM backup_identity WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(CommandError::database)
    }

    pub fn password_revision(&self) -> Result<i64, CommandError> {
        Ok(self
            .database
            .connect()?
            .query_row(
                "SELECT value FROM backup_settings WHERE key='encryption_revision'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(CommandError::database)?
            .and_then(|v| v.parse().ok())
            .unwrap_or(0))
    }
    pub fn enqueue_cloud_cleanup(&self, version: &BackupVersion) -> Result<(), CommandError> {
        let c = self.database.connect()?;
        for provider in &version.synced_to {
            c.execute("INSERT OR IGNORE INTO backup_cloud_cleanup(provider_id,version,hash,config) SELECT id,?1,?2,config FROM backup_targets WHERE id=?3",params![version.version,version.hash,provider]).map_err(CommandError::database)?;
        }
        Ok(())
    }
    pub(super) fn cloud_cleanup(&self) -> Result<Vec<(ProviderRow, i64, String)>, CommandError> {
        let c = self.database.connect()?;
        let mut stmt = c
            .prepare(
                "SELECT provider_id,version,hash,config FROM backup_cloud_cleanup ORDER BY rowid",
            )
            .map_err(CommandError::database)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(CommandError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)?;
        rows.into_iter()
            .map(|(id, version, hash, encrypted)| {
                let plain = zeroize::Zeroizing::new(
                    self.encryptor
                        .decrypt(&encrypted)
                        .map_err(CommandError::database)?,
                );
                let config: BackupTargetConfig =
                    serde_json::from_str(&plain).map_err(CommandError::database)?;
                let meta = BackupTargetMeta {
                    id,
                    name: config.name.clone(),
                    provider_type: config.provider_type.clone(),
                    enabled: true,
                    authorized: config.authorized(),
                    created_at: String::new(),
                    updated_at: String::new(),
                };
                Ok((ProviderRow { meta, config }, version, hash))
            })
            .collect()
    }
    pub fn finish_cloud_cleanup(&self, provider: &str, version: i64) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute(
                "DELETE FROM backup_cloud_cleanup WHERE provider_id=?1 AND version=?2",
                params![provider, version],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }

    pub fn next_version(&self) -> Result<i64, CommandError> {
        self.database
            .connect()?
            .query_row(
                "UPDATE backup_state SET next_version=next_version+1 WHERE id=1 \
                 RETURNING next_version-1",
                [],
                |row| row.get(0),
            )
            .map_err(CommandError::database)
    }

    pub fn add_version(&self, version: &BackupVersion) -> Result<(), CommandError> {
        let synced_to = serde_json::to_string(&version.synced_to).unwrap_or_else(|_| "[]".into());
        self.database
            .connect()?
            .execute(
                "INSERT INTO backup_versions \
                 (id,version,hash,size,file_path,origin,synced_to,created_at,password_revision) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    version.id,
                    version.version,
                    version.hash,
                    version.size,
                    version.file_path,
                    version.origin,
                    synced_to,
                    version.created_at,
                    version.password_revision,
                ],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }

    pub fn latest_version(&self) -> Result<Option<BackupVersion>, CommandError> {
        self.database
            .connect()?
            .query_row(
                &format!(
                    "SELECT {VERSION_COLUMNS} FROM backup_versions ORDER BY version DESC LIMIT 1"
                ),
                [],
                version_from_row,
            )
            .optional()
            .map_err(CommandError::database)
    }

    pub fn get_version(&self, id: &str) -> Result<BackupVersion, CommandError> {
        self.database
            .connect()?
            .query_row(
                &format!("SELECT {VERSION_COLUMNS} FROM backup_versions WHERE id=?1"),
                [id],
                version_from_row,
            )
            .map_err(CommandError::database)
    }

    pub fn list_versions(&self) -> Result<Vec<BackupVersion>, CommandError> {
        let connection = self.database.connect()?;
        let mut statement = connection
            .prepare(&format!(
                "SELECT {VERSION_COLUMNS} FROM backup_versions ORDER BY version DESC"
            ))
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([], version_from_row)
            .map_err(CommandError::database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)
    }

    pub fn delete_version(&self, id: &str) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute("DELETE FROM backup_versions WHERE id=?1", [id])
            .map_err(CommandError::database)?;
        Ok(())
    }

    pub fn mark_synced(&self, version_id: &str, provider_id: &str) -> Result<(), CommandError> {
        self.database.connect()?.execute("UPDATE backup_versions SET synced_to=json_insert(COALESCE(synced_to,'[]'),'$[#]',?1) WHERE id=?2 AND NOT EXISTS(SELECT 1 FROM json_each(synced_to) WHERE value=?1)", params![provider_id,version_id]).map_err(CommandError::database)?;
        Ok(())
    }

    pub fn get_state(&self) -> Result<SyncStateRow, CommandError> {
        self.database
            .connect()?
            .query_row(
                "SELECT status,last_sync_at,conflict_json FROM backup_state WHERE id=1",
                [],
                |row| {
                    Ok(SyncStateRow {
                        status: row.get(0)?,
                        last_sync_at: row.get(1)?,
                        conflict_json: row.get(2)?,
                    })
                },
            )
            .map_err(CommandError::database)
    }

    pub fn touch_last_sync(&self) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute(
                "UPDATE backup_state SET last_sync_at=?1 WHERE id=1",
                [now()],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }

    pub fn load_settings(&self) -> Result<BackupSettings, CommandError> {
        let connection = self.database.connect()?;
        let mut statement = connection
            .prepare("SELECT key,value FROM backup_settings")
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(CommandError::database)?;
        let values = rows
            .collect::<Result<HashMap<_, _>, _>>()
            .map_err(CommandError::database)?;
        let mut settings = BackupSettings::default();
        let string = |key: &str| values.get(key).cloned().unwrap_or_default();
        let boolean =
            |key: &str, default: bool| values.get(key).map_or(default, |value| value == "1");
        let integer = |key: &str, default: i64| {
            values
                .get(key)
                .and_then(|value| value.parse().ok())
                .unwrap_or(default)
        };
        if let Some(value) = values.get("sync_mode").filter(|value| !value.is_empty()) {
            settings.sync_mode.clone_from(value);
        }
        if let Some(value) = values
            .get("conflict_policy")
            .filter(|value| !value.is_empty())
        {
            settings.conflict_policy.clone_from(value);
        }
        if let Some(value) = values
            .get("cloud_retention")
            .filter(|value| !value.is_empty())
        {
            settings.cloud_retention.clone_from(value);
        }
        settings.local_keep_versions = integer("local_keep_versions", 20);
        settings.scheduled_enabled = boolean("scheduled_enabled", false);
        settings.scheduled_interval_hours = integer("scheduled_interval_hours", 0);
        settings.scheduled_daily_time = string("scheduled_daily_time");
        settings.auto_backup_enabled = boolean("auto_backup_enabled", false);
        settings.change_debounce_seconds = integer("change_debounce_seconds", 30);
        if let Some(encrypted) = values
            .get("backup_password")
            .filter(|value| !value.is_empty())
        {
            settings.backup_password_set = true;
            settings.backup_password = self.encryptor.decrypt(encrypted).unwrap_or_default();
        }
        Ok(settings)
    }

    pub fn save_settings(&self, settings: &BackupSettings) -> Result<(), CommandError> {
        let mut connection = self.database.connect()?;
        let connection = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(CommandError::database)?;
        let upsert = |key: &str, value: &str| -> Result<(), CommandError> {
            connection
                .execute(
                    "INSERT INTO backup_settings (key,value) VALUES (?1,?2) \
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![key, value],
                )
                .map_err(CommandError::database)?;
            Ok(())
        };
        for (key, value) in [
            ("sync_mode", settings.sync_mode.clone()),
            ("conflict_policy", settings.conflict_policy.clone()),
            ("cloud_retention", settings.cloud_retention.clone()),
            (
                "local_keep_versions",
                settings.local_keep_versions.to_string(),
            ),
            (
                "scheduled_enabled",
                bool_string(settings.scheduled_enabled).into(),
            ),
            (
                "scheduled_interval_hours",
                settings.scheduled_interval_hours.to_string(),
            ),
            (
                "scheduled_daily_time",
                settings.scheduled_daily_time.clone(),
            ),
            (
                "auto_backup_enabled",
                bool_string(settings.auto_backup_enabled).into(),
            ),
            (
                "change_debounce_seconds",
                settings.change_debounce_seconds.to_string(),
            ),
        ] {
            upsert(key, &value)?;
        }
        if !settings.backup_password.is_empty() {
            let encrypted = self
                .encryptor
                .encrypt(&settings.backup_password)
                .map_err(|error| {
                    CommandError::new("DB_ERROR", format!("encrypt sync password: {error}"))
                })?;
            let old: Option<String> = connection
                .query_row(
                    "SELECT value FROM backup_settings WHERE key='backup_password'",
                    [],
                    |r| r.get(0),
                )
                .optional()
                .map_err(CommandError::database)?;
            let old = old
                .map(|raw| {
                    self.encryptor
                        .decrypt(&raw)
                        .map(zeroize::Zeroizing::new)
                        .map_err(CommandError::database)
                })
                .transpose()?;
            if old.as_deref().map(String::as_str) != Some(settings.backup_password.as_str()) {
                let revision:i64 = connection.query_row("SELECT CAST(value AS INTEGER) FROM backup_settings WHERE key='encryption_revision'",[],|r|r.get(0)).optional().map_err(CommandError::database)?.unwrap_or(0);
                upsert("encryption_revision", &(revision + 1).to_string())?;
            }
            upsert("backup_password", &encrypted)?;
        }
        connection.commit().map_err(CommandError::database)
    }

    pub fn log_event(
        &self,
        provider_id: &str,
        action: &str,
        version: i64,
        success: bool,
        error: &str,
    ) {
        let Ok(connection) = self.database.connect() else {
            return;
        };
        let _ = connection.execute(
            "INSERT INTO backup_events \
             (id,provider_id,action,version,success,error,created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                uuid::Uuid::new_v4().to_string(),
                provider_id,
                action,
                version,
                success,
                error,
                now(),
            ],
        );
    }

    pub fn list_events(&self, limit: i64) -> Result<Vec<BackupEvent>, CommandError> {
        let connection = self.database.connect()?;
        let mut statement = connection
            .prepare(
                "SELECT id,provider_id,action,version,success,error,created_at \
                 FROM backup_events ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([if limit <= 0 { 50 } else { limit }], |row| {
                Ok(BackupEvent {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    action: row.get(2)?,
                    version: row.get(3)?,
                    success: row.get(4)?,
                    error: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(CommandError::database)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)
    }

    pub(super) fn create_provider(
        &self,
        config: &BackupTargetConfig,
    ) -> Result<ProviderRow, CommandError> {
        let raw =
            zeroize::Zeroizing::new(serde_json::to_string(config).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&raw)
            .map_err(|error| CommandError::new("DB_ERROR", format!("加密配置失败: {error}")))?;
        let timestamp = now();
        let meta = BackupTargetMeta {
            id: uuid::Uuid::new_v4().to_string(),
            provider_type: config.provider_type.clone(),
            name: config.name.clone(),
            enabled: config.enabled,
            authorized: false,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        self.database
            .connect()?
            .execute(
                "INSERT INTO backup_targets \
                 (id,type,name,enabled,config,created_at,updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    meta.id,
                    meta.provider_type,
                    meta.name,
                    meta.enabled,
                    encrypted,
                    meta.created_at,
                    meta.updated_at,
                ],
            )
            .map_err(CommandError::database)?;
        Ok(ProviderRow {
            meta,
            config: config.clone(),
        })
    }

    pub(super) fn get_provider(&self, id: &str) -> Result<ProviderRow, CommandError> {
        let connection = self.database.connect()?;
        let raw = connection
            .query_row(
                &format!("SELECT {PROVIDER_COLUMNS} FROM backup_targets WHERE id=?1"),
                [id],
                provider_raw_from_row,
            )
            .map_err(CommandError::database)?;
        self.decrypt_provider(raw)
    }

    pub(super) fn list_providers(
        &self,
        enabled_only: bool,
    ) -> Result<Vec<ProviderRow>, CommandError> {
        let connection = self.database.connect()?;
        let query = if enabled_only {
            format!(
                "SELECT {PROVIDER_COLUMNS} FROM backup_targets WHERE enabled=1 ORDER BY created_at"
            )
        } else {
            format!("SELECT {PROVIDER_COLUMNS} FROM backup_targets ORDER BY created_at")
        };
        let mut statement = connection.prepare(&query).map_err(CommandError::database)?;
        let rows = statement
            .query_map([], provider_raw_from_row)
            .map_err(CommandError::database)?;
        rows.map(|row| row.map_err(CommandError::database))
            .map(|result| result.and_then(|raw| self.decrypt_provider(raw)))
            .collect()
    }

    pub fn update_provider(
        &self,
        id: &str,
        config: &BackupTargetConfig,
    ) -> Result<(), CommandError> {
        let existing = self.get_provider(id)?;
        let merged = merge_secrets(&existing.config, config);
        let raw = zeroize::Zeroizing::new(
            serde_json::to_string(&merged).map_err(CommandError::database)?,
        );
        let encrypted = self
            .encryptor
            .encrypt(&raw)
            .map_err(|error| CommandError::new("DB_ERROR", format!("加密配置失败: {error}")))?;
        let mut connection = self.database.connect()?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(CommandError::database)?;
        tx.execute(
            "UPDATE backup_targets SET type=?1,name=?2,enabled=?3,config=?4,\
                 updated_at=?5 WHERE id=?6",
            params![
                merged.provider_type,
                merged.name,
                merged.enabled,
                encrypted,
                now(),
                id,
            ],
        )
        .map_err(CommandError::database)?;
        // A confirmation belongs to the uploaded configuration. Reconfirm only
        // the latest immutable version after the user edits a target.
        tx.execute("UPDATE backup_versions SET synced_to=(SELECT json_group_array(value) FROM json_each(backup_versions.synced_to) WHERE value!=?1) WHERE id=(SELECT id FROM backup_versions ORDER BY version DESC LIMIT 1)", [id]).map_err(CommandError::database)?;
        tx.commit().map_err(CommandError::database)
    }

    pub fn save_provider_config(
        &self,
        id: &str,
        config: &BackupTargetConfig,
    ) -> Result<(), CommandError> {
        let raw =
            zeroize::Zeroizing::new(serde_json::to_string(config).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&raw)
            .map_err(|error| CommandError::new("DB_ERROR", format!("加密配置失败: {error}")))?;
        self.database
            .connect()?
            .execute(
                "UPDATE backup_targets SET config=?1,updated_at=?2 WHERE id=?3",
                params![encrypted, now(), id],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }

    pub fn delete_provider(&self, id: &str) -> Result<(), CommandError> {
        let changed = self
            .database
            .connect()?
            .execute("DELETE FROM backup_targets WHERE id=?1", [id])
            .map_err(CommandError::database)?;
        if changed == 0 {
            return Err(CommandError::new("DB_ERROR", "provider not found"));
        }
        Ok(())
    }

    pub(crate) fn account_provider_enabled(&self) -> Result<Option<bool>, CommandError> {
        Ok(self
            .list_providers(false)?
            .into_iter()
            .find(|row| row.config.provider_type == "account")
            .map(|row| row.meta.enabled))
    }

    pub(crate) fn ensure_account_provider(&self, name: &str) -> Result<(), CommandError> {
        if self.account_provider_enabled()?.is_some() {
            return Ok(());
        }
        let mut config = BackupTargetConfig::default();
        config.provider_type = "account".into();
        config.name = name.into();
        config.enabled = true;
        self.create_provider(&config)?;
        Ok(())
    }

    fn decrypt_provider(&self, raw: ProviderRaw) -> Result<ProviderRow, CommandError> {
        let plain =
            zeroize::Zeroizing::new(self.encryptor.decrypt(&raw.encrypted).map_err(|error| {
                CommandError::new("DB_ERROR", format!("解密配置失败: {error}"))
            })?);
        let config = serde_json::from_str(&plain)
            .map_err(|error| CommandError::new("DB_ERROR", format!("配置数据损坏: {error}")))?;
        Ok(ProviderRow {
            meta: BackupTargetMeta {
                id: raw.id,
                provider_type: raw.provider_type,
                name: raw.name,
                enabled: raw.enabled,
                authorized: false,
                created_at: raw.created_at,
                updated_at: raw.updated_at,
            },
            config,
        })
    }
}

struct ProviderRaw {
    id: String,
    provider_type: String,
    name: String,
    enabled: bool,
    encrypted: String,
    created_at: String,
    updated_at: String,
}

fn provider_raw_from_row(row: &Row<'_>) -> rusqlite::Result<ProviderRaw> {
    Ok(ProviderRaw {
        id: row.get(0)?,
        provider_type: row.get(1)?,
        name: row.get(2)?,
        enabled: row.get(3)?,
        encrypted: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn version_from_row(row: &Row<'_>) -> rusqlite::Result<BackupVersion> {
    let synced_to: String = row.get(6)?;
    Ok(BackupVersion {
        id: row.get(0)?,
        version: row.get(1)?,
        hash: row.get(2)?,
        size: row.get(3)?,
        file_path: row.get(4)?,
        origin: row.get(5)?,
        synced_to: serde_json::from_str(&synced_to).unwrap_or_default(),
        created_at: row.get(7)?,
        password_revision: row.get(8)?,
    })
}

fn merge_secrets(old: &BackupTargetConfig, new: &BackupTargetConfig) -> BackupTargetConfig {
    let mut output = new.clone();
    if output.password.is_empty() {
        output.password.clone_from(&old.password);
    }
    if output.s3_secret_key.is_empty() {
        output.s3_secret_key.clone_from(&old.s3_secret_key);
    }
    if output.oauth_client_secret.is_empty() {
        output
            .oauth_client_secret
            .clone_from(&old.oauth_client_secret);
    }
    output
        .oauth_access_token
        .clone_from(&old.oauth_access_token);
    output
        .oauth_refresh_token
        .clone_from(&old.oauth_refresh_token);
    output.oauth_expiry.clone_from(&old.oauth_expiry);
    if output.drive_folder_id.is_empty() {
        output.drive_folder_id.clone_from(&old.drive_folder_id);
    }
    if output.onedrive_folder.is_empty() {
        output.onedrive_folder.clone_from(&old.onedrive_folder);
    }
    output
}

fn bool_string(value: bool) -> &'static str {
    if value {
        "1"
    } else {
        "0"
    }
}

fn now() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::AutoSi, true)
}
