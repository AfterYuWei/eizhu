use super::tunnel::TunnelConfig;
use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};
use rusqlite::{params, OptionalExtension};
use zeroize::Zeroizing;
#[derive(Clone)]
pub(crate) struct TunnelRepository {
    database: Database,
    encryptor: Encryptor,
}
impl TunnelRepository {
    pub(crate) fn new(database: Database, encryptor: Encryptor) -> Self {
        Self {
            database,
            encryptor,
        }
    }
    pub(super) fn list(&self) -> Result<Vec<TunnelConfig>, CommandError> {
        let connection = self.database.connect()?;
        let mut statement = connection
            .prepare("SELECT payload FROM local_tunnels ORDER BY id")
            .map_err(CommandError::database)?;
        let payloads = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(CommandError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)?;
        payloads
            .into_iter()
            .map(|encrypted| {
                let body = Zeroizing::new(
                    self.encryptor
                        .decrypt(&encrypted)
                        .map_err(CommandError::database)?,
                );
                serde_json::from_str(&body).map_err(CommandError::database)
            })
            .collect()
    }
    pub(super) fn get(&self, id: &str) -> Result<TunnelConfig, CommandError> {
        let payload = self
            .database
            .connect()?
            .query_row(
                "SELECT payload FROM local_tunnels WHERE id=?1",
                [id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(CommandError::database)?
            .ok_or_else(|| CommandError::new("NOT_FOUND", "隧道配置不存在"))?;
        let body = Zeroizing::new(
            self.encryptor
                .decrypt(&payload)
                .map_err(CommandError::database)?,
        );
        serde_json::from_str(&body).map_err(CommandError::database)
    }
    pub(super) fn save(&self, config: &TunnelConfig) -> Result<(), CommandError> {
        let body = Zeroizing::new(serde_json::to_string(config).map_err(CommandError::database)?);
        let payload = self
            .encryptor
            .encrypt(&body)
            .map_err(CommandError::database)?;
        self.database.connect()?.execute("INSERT INTO local_tunnels(id,payload) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![config.id, payload]).map_err(CommandError::database)?;
        Ok(())
    }
    pub(super) fn remove(&self, id: &str) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute("DELETE FROM local_tunnels WHERE id=?1", [id])
            .map_err(CommandError::database)?;
        Ok(())
    }
}
