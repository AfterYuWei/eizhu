use rusqlite::{params, OptionalExtension};

use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};

use super::model::AccountSession;

#[derive(Clone)]
pub(super) struct AccountRepository {
    database: Database,
    encryptor: Encryptor,
}

impl AccountRepository {
    pub fn new(database: Database, encryptor: Encryptor) -> Self {
        Self {
            database,
            encryptor,
        }
    }

    pub fn load(&self) -> Result<Option<AccountSession>, CommandError> {
        let encrypted = self
            .database
            .connect()?
            .query_row("SELECT token FROM account_session WHERE id=1", [], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(CommandError::database)?;
        encrypted
            .map(|value| {
                let plain = self
                    .encryptor
                    .decrypt(&value)
                    .map_err(|_| CommandError::new("ACCOUNT_FAILED", "本地账号登录态无法解密"))?;
                serde_json::from_str(&plain)
                    .map_err(|_| CommandError::new("ACCOUNT_FAILED", "本地账号登录态已损坏"))
            })
            .transpose()
    }

    pub fn save(&self, session: &AccountSession) -> Result<(), CommandError> {
        let plain = serde_json::to_string(session)
            .map_err(|_| CommandError::new("ACCOUNT_FAILED", "无法保存账号登录态"))?;
        let encrypted = self
            .encryptor
            .encrypt(&plain)
            .map_err(|_| CommandError::new("ACCOUNT_FAILED", "无法加密账号登录态"))?;
        self.database
            .connect()?
            .execute(
                "INSERT INTO account_session (id,email,token,updated_at) \
                 VALUES (1,?1,?2,CURRENT_TIMESTAMP) \
                 ON CONFLICT(id) DO UPDATE SET email=excluded.email,token=excluded.token,\
                 updated_at=excluded.updated_at",
                params![session.email, encrypted],
            )
            .map_err(CommandError::database)?;
        Ok(())
    }

    pub fn clear(&self) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute("DELETE FROM account_session WHERE id=1", [])
            .map_err(CommandError::database)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_session_is_encrypted_and_round_trips() {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::initialize(directory.path().join("eizhu.db")).unwrap();
        let encryptor = Encryptor::load_or_create(directory.path().join("key")).unwrap();
        let repository = AccountRepository::new(database.clone(), encryptor);
        let session = AccountSession {
            email: "user@example.com".into(),
            access_token: "access-secret".into(),
            refresh_token: "refresh-secret".into(),
            expires_in: 1800,
            storage_used: 12,
            storage_quota: 100,
        };
        repository.save(&session).unwrap();

        let raw: String = database
            .connect()
            .unwrap()
            .query_row("SELECT token FROM account_session WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(!raw.contains("access-secret"));
        let restored = repository.load().unwrap().unwrap();
        assert_eq!(restored.email, "user@example.com");
        assert_eq!(restored.refresh_token, "refresh-secret");

        repository.clear().unwrap();
        assert!(repository.load().unwrap().is_none());
    }
}
