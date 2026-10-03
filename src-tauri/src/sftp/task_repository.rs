//! Workspace-local, encrypted transfer descriptions and authoritative checkpoints.
use crate::{error::CommandError, infrastructure::database::Database, vault::Encryptor};
use rusqlite::{params, OptionalExtension};
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
    #[serde(default, skip_serializing)]
    pub blocks: Vec<BlockDigest>,
    pub confirmed_offset: u64,
    pub committed: bool,
    #[serde(default)]
    pub committing: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct TransferRecord {
    pub task: TransferTask,
    pub descriptor: TransferDescriptor,
    #[serde(default, skip_serializing)]
    pub files: Vec<FileCheckpoint>,
    pub temporary_paths: Vec<String>,
    pub prepared: bool,
    #[serde(default)]
    pub directories: Vec<(String, String)>,
    #[serde(default)]
    pub archives: Vec<ArchiveCheckpoint>,
    #[serde(default)]
    pub session_ids: Vec<String>,
    #[serde(default)]
    pub pending_cleanup: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct ArchiveCheckpoint {
    pub source_root: String,
    pub output: String,
    pub format: String,
    pub target_profile: Option<String>,
    pub target: String,
    pub original_target: Option<String>,
    pub generated: bool,
}

#[derive(Clone)]
pub(crate) struct TransferRepository {
    database: Database,
    encryptor: Encryptor,
}
impl TransferRepository {
    pub(super) fn storage_root(&self) -> Result<std::path::PathBuf, CommandError> {
        let connection = self.database.connect()?;
        let path = connection
            .path()
            .ok_or_else(|| CommandError::new("TRANSFER_STORAGE", "任务暂存需要持久化数据库"))?;
        Ok(std::path::Path::new(path)
            .parent()
            .ok_or_else(|| CommandError::new("TRANSFER_STORAGE", "数据库目录无效"))?
            .join("transfer-staging"))
    }
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
        self.save_on(record, None)
    }
    pub(super) fn save_checkpoint(
        &self,
        record: &TransferRecord,
        index: usize,
    ) -> Result<(), CommandError> {
        self.save_on(record, Some(index))
    }
    fn save_on(&self, record: &TransferRecord, index: Option<usize>) -> Result<(), CommandError> {
        let body = Zeroizing::new(serde_json::to_string(record).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&body)
            .map_err(CommandError::database)?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction().map_err(CommandError::database)?;
        let updated=transaction.execute("INSERT INTO local_transfers(id,generation,payload) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,payload=excluded.payload WHERE local_transfers.generation<=excluded.generation",params![record.task.id,record.task.execution_generation,encrypted]).map_err(CommandError::database)?;
        if updated == 0 {
            return Err(CommandError::new(
                "TRANSFER_STALE",
                "忽略旧执行代次的任务状态",
            ));
        }
        if let Some(index) = index {
            self.save_file(&transaction, &record.task.id, index, &record.files[index])?;
        } else {
            transaction
                .execute(
                    "DELETE FROM local_transfer_files WHERE task_id=?1 AND file_index>=?2",
                    params![record.task.id, record.files.len()],
                )
                .map_err(CommandError::database)?;
            for (index, file) in record.files.iter().enumerate() {
                self.save_file(&transaction, &record.task.id, index, file)?;
            }
        }
        transaction.commit().map_err(CommandError::database)
    }
    fn save_file(
        &self,
        transaction: &rusqlite::Transaction<'_>,
        id: &str,
        index: usize,
        file: &FileCheckpoint,
    ) -> Result<(), CommandError> {
        let old: Option<String> = transaction
            .query_row(
                "SELECT payload FROM local_transfer_files WHERE task_id=?1 AND file_index=?2",
                params![id, index],
                |r| r.get(0),
            )
            .optional()
            .map_err(CommandError::database)?;
        if let Some(old) = old {
            let raw = Zeroizing::new(
                self.encryptor
                    .decrypt(&old)
                    .map_err(CommandError::database)?,
            );
            let prior: FileCheckpoint =
                serde_json::from_str(&raw).map_err(CommandError::database)?;
            if prior.stage != file.stage || prior.confirmed_offset > file.confirmed_offset {
                transaction
                    .execute(
                        "DELETE FROM local_transfer_blocks WHERE task_id=?1 AND file_index=?2",
                        params![id, index],
                    )
                    .map_err(CommandError::database)?;
            }
        }
        let raw = Zeroizing::new(serde_json::to_string(file).map_err(CommandError::database)?);
        let encrypted = self
            .encryptor
            .encrypt(&raw)
            .map_err(CommandError::database)?;
        transaction.execute("INSERT INTO local_transfer_files(task_id,file_index,payload) VALUES(?1,?2,?3) ON CONFLICT(task_id,file_index) DO UPDATE SET payload=excluded.payload",params![id,index,encrypted]).map_err(CommandError::database)?;
        let count: i64 = transaction
            .query_row(
                "SELECT count(*) FROM local_transfer_blocks WHERE task_id=?1 AND file_index=?2",
                params![id, index],
                |r| r.get(0),
            )
            .map_err(CommandError::database)?;
        if count as usize > file.blocks.len() {
            return Err(CommandError::new(
                "CHECKPOINT_INVALID",
                "分块记录与检查点不一致",
            ));
        }
        for (block_index, block) in file.blocks.iter().enumerate().skip(count as usize) {
            let raw = Zeroizing::new(serde_json::to_string(block).map_err(CommandError::database)?);
            let encrypted = self
                .encryptor
                .encrypt(&raw)
                .map_err(CommandError::database)?;
            transaction.execute("INSERT INTO local_transfer_blocks(task_id,file_index,block_index,payload) VALUES(?1,?2,?3,?4)",params![id,index,block_index,encrypted]).map_err(CommandError::database)?;
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
                let mut record: TransferRecord =
                    serde_json::from_str(&body).map_err(CommandError::database)?;
                if record.task.id != id {
                    return Err(CommandError::new("TRANSFER_INVALID", "任务记录身份不匹配"));
                }
                let mut files=connection.prepare("SELECT file_index,payload FROM local_transfer_files WHERE task_id=?1 ORDER BY file_index").map_err(CommandError::database)?;
                let rows=files.query_map([&id],|r|Ok((r.get::<_,usize>(0)?,r.get::<_,String>(1)?))).map_err(CommandError::database)?.collect::<Result<Vec<_>,_>>().map_err(CommandError::database)?;
                if !rows.is_empty() {
                    record.files.clear();
                    for (index,encrypted) in rows {
                        if index!=record.files.len() {return Err(CommandError::new("CHECKPOINT_INVALID","文件记录顺序不完整"))}
                        let raw=Zeroizing::new(self.encryptor.decrypt(&encrypted).map_err(CommandError::database)?);let mut file:FileCheckpoint=serde_json::from_str(&raw).map_err(CommandError::database)?;
                        let mut blocks=connection.prepare("SELECT block_index,payload FROM local_transfer_blocks WHERE task_id=?1 AND file_index=?2 ORDER BY block_index").map_err(CommandError::database)?;
                        let rows=blocks.query_map(params![id,index],|r|Ok((r.get::<_,usize>(0)?,r.get::<_,String>(1)?))).map_err(CommandError::database)?.collect::<Result<Vec<_>,_>>().map_err(CommandError::database)?;
                        for (index,encrypted) in rows {if index!=file.blocks.len() {return Err(CommandError::new("CHECKPOINT_INVALID","分块记录顺序不完整"))} let raw=Zeroizing::new(self.encryptor.decrypt(&encrypted).map_err(CommandError::database)?);file.blocks.push(serde_json::from_str(&raw).map_err(CommandError::database)?);}
                        record.files.push(file);
                    }
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
    fn checkpoint_rows_are_incremental_encrypted_and_transactional() {
        let dir = tempfile::tempdir().unwrap();
        let (db, _, repository) = state(dir.path());
        let mut task = TransferTask::new("task-id".into(), "私有文件".into(), "upload", 8);
        task.execution_generation = 1;
        task.confirmed_offset = 4;
        task.status = "paused".into();
        let mut record = TransferRecord {
            task,
            descriptor: TransferDescriptor::Upload {
                target_profile: "local".into(),
                destination: "/private/target".into(),
                size: 8,
                last_modified: Some(1),
            },
            files: vec![FileCheckpoint {
                source_profile: "browser".into(),
                source: "private-source".into(),
                target_profile: "local".into(),
                target: "/private/target".into(),
                stage: "/private/stage".into(),
                size: 8,
                modified: "1".into(),
                original_target: None,
                blocks: vec![BlockDigest {
                    length: 4,
                    sha256: "a".repeat(64),
                }],
                confirmed_offset: 4,
                committed: false,
                committing: false,
            }],
            temporary_paths: vec![],
            prepared: true,
            directories: vec![],
            archives: vec![],
            session_ids: vec![],
            pending_cleanup: false,
        };
        repository.save(&record).unwrap();
        let connection = db.connect().unwrap();
        let original: String = connection
            .query_row("SELECT payload FROM local_transfer_blocks", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!original.contains(&"a".repeat(64)));
        let metadata: String = connection
            .query_row("SELECT payload FROM local_transfer_files", [], |r| r.get(0))
            .unwrap();
        assert!(!metadata.contains("/private"));
        connection.execute_batch("CREATE TRIGGER reject_test_block BEFORE INSERT ON local_transfer_blocks WHEN NEW.block_index=1 BEGIN SELECT RAISE(FAIL,'simulated disk failure'); END;").unwrap();
        record.task.execution_generation = 2;
        record.task.confirmed_offset = 8;
        record.files[0].confirmed_offset = 8;
        record.files[0].blocks.push(BlockDigest {
            length: 4,
            sha256: "b".repeat(64),
        });
        assert_eq!(
            repository.save_checkpoint(&record, 0).unwrap_err().code,
            "DB_ERROR"
        );
        let old = repository.list().unwrap();
        assert_eq!(old[0].task.execution_generation, 1);
        assert_eq!(old[0].files[0].confirmed_offset, 4);
        assert_eq!(old[0].files[0].blocks.len(), 1);
        connection
            .execute_batch("DROP TRIGGER reject_test_block;")
            .unwrap();
        repository.save_checkpoint(&record, 0).unwrap();
        assert_eq!(
            connection
                .query_row::<String, _, _>(
                    "SELECT payload FROM local_transfer_blocks WHERE block_index=0",
                    [],
                    |r| r.get(0)
                )
                .unwrap(),
            original
        );
        assert_eq!(repository.list().unwrap()[0].files[0].blocks.len(), 2);
        Database::initialize(dir.path().join("db")).unwrap();
        repository.remove("task-id").unwrap();
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT count(*) FROM local_transfer_files", [], |r| r
                    .get(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row::<i64, _, _>("SELECT count(*) FROM local_transfer_blocks", [], |r| r
                    .get(0))
                .unwrap(),
            0
        );
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
            directories: vec![],
            archives: vec![],
            session_ids: vec![],
            pending_cleanup: false,
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
