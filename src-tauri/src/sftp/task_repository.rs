//! Workspace-local, encrypted transfer descriptions and authoritative checkpoints.
use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::transfer::TransferTask;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum TransferDescriptor {
    Copy {
        source_profile: String,
        target_profile: String,
        paths: Vec<String>,
        destination: String,
        resolution: String,
        directory_mode: String,
    },
    Download {
        source_profile: String,
        paths: Vec<String>,
        artifact: String,
    },
    Upload {
        target_profile: String,
        destination: String,
        size: u64,
        last_modified: Option<u64>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct BlockDigest {
    pub length: u64,
    pub sha256: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct FileCheckpoint {
    pub source_profile: String,
    pub source: String,
    pub target_profile: String,
    pub target: String,
    pub stage: String,
    pub size: u64,
    pub modified: String,
    pub original_target: Option<String>,
    pub blocks: Vec<BlockDigest>,
    pub confirmed_offset: u64,
    pub committed: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct TransferRecord {
    pub task: TransferTask,
    pub descriptor: TransferDescriptor,
    pub files: Vec<FileCheckpoint>,
    pub temporary_paths: Vec<String>,
    pub prepared: bool,
}

#[derive(Clone)]
pub(crate) struct TransferRepository {
    database: Database,
    encryptor: Encryptor,
}
impl TransferRepository {
    pub fn new(database: Database, encryptor: Encryptor) -> Result<Self, CommandError> {
        let repository = Self {
            database,
            encryptor,
        };
        for mut record in repository.list()? {
            if matches!(
                record.task.status.as_str(),
                "queued" | "transferring" | "pausing"
            ) {
                record.task.status = "recoverable".into();
                record.task.execution_generation += 1;
                record.task.speed = 0;
                record.task.retryable = true;
                record.task.error_code = "PROCESS_INTERRUPTED".into();
                record.task.error_message = "任务已中断，请手动继续；继续前将重新核对文件".into();
                repository.save(&record)?;
            }
        }
        Ok(repository)
    }
    pub(super) fn save(&self, record: &TransferRecord) -> Result<(), CommandError> {
        let body = Zeroizing::new(serde_json::to_string(record).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&body)
            .map_err(CommandError::database)?;
        let updated = self.database.connect()?.execute("INSERT INTO local_transfers(id,generation,payload) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,payload=excluded.payload WHERE local_transfers.generation<=excluded.generation", params![record.task.id,record.task.execution_generation,encrypted]).map_err(CommandError::database)?;
        if updated == 0 {
            return Err(CommandError::new(
                "TRANSFER_STALE",
                "忽略旧执行代次的任务状态",
            ));
        }
        Ok(())
    }
    pub(super) fn list(&self) -> Result<Vec<TransferRecord>, CommandError> {
        let connection = self.database.connect()?;
        let mut statement = connection
            .prepare("SELECT id,payload FROM local_transfers ORDER BY rowid DESC")
            .map_err(CommandError::database)?;
        let rows = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(CommandError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(CommandError::database)?;
        rows.into_iter()
            .map(|(id, encrypted)| {
                let body = Zeroizing::new(
                    self.encryptor
                        .decrypt(&encrypted)
                        .map_err(CommandError::database)?,
                );
                let record: TransferRecord =
                    serde_json::from_str(&body).map_err(CommandError::database)?;
                if record.task.id != id {
                    return Err(CommandError::new("TRANSFER_INVALID", "任务记录身份不匹配"));
                }
                Ok(record)
            })
            .collect()
    }
    pub(super) fn remove(&self, id: &str) -> Result<(), CommandError> {
        self.database
            .connect()?
            .execute("DELETE FROM local_transfers WHERE id=?1", [id])
            .map_err(CommandError::database)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state(path: &std::path::Path) -> (Database, Encryptor, TransferRepository) {
        let db = Database::initialize(path.join("db")).unwrap();
        let key = Encryptor::load_or_create(path.join("key")).unwrap();
        let capture = key.clone();
        db.configure_capture(move |v| capture.encrypt(v).map_err(|e| e.to_string()));
        let repo = TransferRepository::new(db.clone(), key.clone()).unwrap();
        (db, key, repo)
    }
    #[test]
    fn records_are_local_encrypted_and_recover_manually_with_generation_guards() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let (db, key, repo) = state(first.path());
        let record = TransferRecord {
            task: TransferTask::new("id".into(), "私有文件".into(), "upload", 12),
            descriptor: TransferDescriptor::Upload {
                target_profile: "private-profile".into(),
                destination: "/private/path".into(),
                size: 12,
                last_modified: Some(42),
            },
            files: vec![],
            temporary_paths: vec![],
            prepared: false,
        };
        repo.save(&record).unwrap();
        let raw: String = db
            .connect()
            .unwrap()
            .query_row("SELECT payload FROM local_transfers", [], |r| r.get(0))
            .unwrap();
        assert!(!raw.contains("私有文件"));
        assert!(!raw.contains("/private/path"));
        let count: i64 = db
            .connect()
            .unwrap()
            .query_row("SELECT count(*) FROM realtime_outbox", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        assert!(state(second.path()).2.list().unwrap().is_empty());
        let reopened = Database::initialize(first.path().join("db")).unwrap();
        let repo = TransferRepository::new(reopened, key).unwrap();
        let recovered = repo.list().unwrap();
        assert_eq!(recovered[0].task.status, "recoverable");
        assert!(recovered[0].task.retryable);
        assert_eq!(recovered[0].task.execution_generation, 1);
        assert_eq!(repo.save(&record).unwrap_err().code, "TRANSFER_STALE");
        repo.remove("id").unwrap();
        assert!(repo.list().unwrap().is_empty());
    }
}
