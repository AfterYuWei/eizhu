use rusqlite::{params, OptionalExtension, TransactionBehavior};
use zeroize::Zeroizing;

use super::{HistoryEntry, LocalStateKey};
use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};

#[derive(Clone)]
pub(super) struct LocalStateRepository {
    pub database: Database,
    encryptor: Encryptor,
}

impl LocalStateRepository {
    pub fn new(database: Database, encryptor: Encryptor) -> Self {
        Self {
            database,
            encryptor,
        }
    }
    pub fn profile_exists(&self, profile_id: &str) -> Result<bool, CommandError> {
        self.database
            .connect()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM profiles WHERE id=?1)",
                [profile_id],
                |row| row.get(0),
            )
            .map_err(CommandError::database)
    }
    pub fn read(&self, key: LocalStateKey) -> Result<Option<serde_json::Value>, CommandError> {
        let value: Option<String> = self
            .database
            .connect()?
            .query_row(
                "SELECT payload FROM local_preferences WHERE key=?1",
                [key.as_str()],
                |r| r.get(0),
            )
            .optional()
            .map_err(CommandError::database)?;
        value
            .map(|value| {
                let raw = Zeroizing::new(
                    self.encryptor
                        .decrypt(&value)
                        .map_err(CommandError::database)?,
                );
                serde_json::from_str(&raw).map_err(CommandError::database)
            })
            .transpose()
    }
    pub fn write(&self, key: LocalStateKey, value: &serde_json::Value) -> Result<(), CommandError> {
        let raw = Zeroizing::new(serde_json::to_string(value).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&raw)
            .map_err(CommandError::database)?;
        self.database.connect()?.execute("INSERT INTO local_preferences(key,payload) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload", params![key.as_str(), encrypted]).map_err(CommandError::database)?;
        Ok(())
    }
    pub fn mutate_history<T>(
        &self,
        profile_id: &str,
        mutate: impl FnOnce(&mut Vec<HistoryEntry>) -> Result<T, CommandError>,
    ) -> Result<T, CommandError> {
        let mut connection = self.database.connect()?;
        let tx = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(CommandError::database)?;
        let encrypted: Option<String> = tx
            .query_row(
                "SELECT payload FROM local_history WHERE profile_id=?1",
                [profile_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(CommandError::database)?;
        let mut entries: Vec<HistoryEntry> = match encrypted {
            Some(value) => serde_json::from_str(&Zeroizing::new(
                self.encryptor
                    .decrypt(&value)
                    .map_err(CommandError::database)?,
            ))
            .map_err(CommandError::database)?,
            None => vec![],
        };
        let result = mutate(&mut entries)?;
        let raw = Zeroizing::new(serde_json::to_string(&entries).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&raw)
            .map_err(CommandError::database)?;
        tx.execute("INSERT INTO local_history(profile_id,payload) VALUES(?1,?2) ON CONFLICT(profile_id) DO UPDATE SET payload=excluded.payload", params![profile_id, encrypted]).map_err(CommandError::database)?;
        tx.commit().map_err(CommandError::database)?;
        Ok(result)
    }
    pub fn clear_history(&self) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute("DELETE FROM local_history", [])
            .map_err(CommandError::database)?;
        Ok(())
    }
}
