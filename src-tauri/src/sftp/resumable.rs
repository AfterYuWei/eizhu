//! Tracked, resumable transfers. Checkpoints and offsets are owned exclusively by Rust.
use super::{
    backend::{base_name, clean_path, format_time, join_path, local_path_to_api, FileBackend},
    state::SftpService,
    task_repository::{
        ArchiveCheckpoint, BlockDigest, FileCheckpoint, TransferDescriptor, TransferRecord,
        TransferRepository,
    },
    transfer::{
        archive_name, auto_rename, make_tar_gz_from_directory, make_zip_from_directory,
        parent_path, SpeedMeter, TransferTask,
    },
    SftpError, SftpEventSink,
};
use crate::error::CommandError;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::{
    sync::{Mutex, OwnedSemaphorePermit, RwLock, Semaphore},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

pub(super) const BLOCK_SIZE: usize = 1024 * 1024;
type Backends = HashMap<String, Arc<FileBackend>>;
type Entry = Arc<Mutex<TransferRecord>>;
struct Control {
    requested: AtomicU8,
    stop: CancellationToken,
    permit: Mutex<Option<OwnedSemaphorePermit>>,
}
impl Control {
    fn new() -> Self {
        Self {
            requested: AtomicU8::new(0),
            stop: CancellationToken::new(),
            permit: Mutex::new(None),
        }
    }
}
#[derive(Clone)]
struct UploadHandle {
    entry: Entry,
    generation: u64,
    target: Arc<FileBackend>,
    control: Arc<Control>,
}
struct EmittedProgress {
    at: Instant,
    generation: u64,
    status: String,
    bytes: u64,
}
#[derive(Clone)]
pub(super) struct ResumableTransfers {
    records: Arc<RwLock<HashMap<String, Entry>>>,
    controls: Arc<Mutex<HashMap<String, Arc<Control>>>>,
    workers: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    uploads: Arc<Mutex<HashMap<String, UploadHandle>>>,
    operations: Arc<Mutex<()>>,
    repository: TransferRepository,
    semaphore: Arc<Semaphore>,
    root: PathBuf,
    emitted: Arc<std::sync::Mutex<HashMap<String, EmittedProgress>>>,
    #[cfg(test)]
    write_fault: Arc<Mutex<Option<CommandError>>>,
}
fn io_error(error: SftpError) -> CommandError {
    let message = error.to_string();
    CommandError::new(
        if message.contains("os error 28") || message.contains("No space left") {
            "DISK_FULL"
        } else {
            "TRANSFER_IO"
        },
        message,
    )
    .retryable()
}
async fn bounded<T>(
    future: impl std::future::Future<Output = Result<T, SftpError>>,
) -> Result<T, CommandError> {
    tokio::time::timeout(Duration::from_secs(30), future)
        .await
        .map_err(|_| {
            CommandError::new("TRANSFER_TIMEOUT", "文件操作超时，请检查连接后继续").retryable()
        })?
        .map_err(io_error)
}
fn stopped(control: &Control) -> Result<(), CommandError> {
    if control.requested.load(Ordering::Acquire) != 0 {
        Err(CommandError::new("TRANSFER_STOPPED", "任务已停止"))
    } else {
        Ok(())
    }
}
fn backend<'a>(backends: &'a Backends, profile: &str) -> Result<&'a FileBackend, CommandError> {
    backends.get(profile).map(Arc::as_ref).ok_or_else(|| {
        CommandError::new(
            "SFTP_CONNECT_REQUIRED",
            format!("请先连接任务所需服务器：{profile}"),
        )
        .retryable()
    })
}
async fn signature(
    backend: &FileBackend,
    path: &str,
    control: Option<&Control>,
) -> Result<Option<String>, CommandError> {
    let Some(symlink) = bounded(backend.entry_kind(path)).await? else {
        return Ok(None);
    };
    if symlink {
        return Err(CommandError::new(
            "TRANSFER_SYMLINK",
            "请直接选择文件，暂不通过符号链接传输",
        ));
    }
    let info = bounded(backend.stat(path)).await?;
    if info.is_dir {
        return Err(CommandError::new(
            "PATH_EXISTS",
            "目标是目录，请选择其他文件名",
        ));
    }
    let mut hasher = Sha256::new();
    let mut offset = 0;
    while offset < info.size {
        if let Some(control) = control {
            stopped(control)?;
        }
        let length = (info.size - offset).min(BLOCK_SIZE as u64) as usize;
        let bytes = bounded(backend.read_chunk_at(path, offset, length)).await?;
        hasher.update(bytes);
        offset += length as u64;
    }
    Ok(Some(format!(
        "{}:{}:{}",
        info.size,
        format_time(info.modified),
        hex::encode(hasher.finalize())
    )))
}
async fn destination(
    target: &FileBackend,
    path: String,
    resolution: &str,
) -> Result<Option<String>, CommandError> {
    if bounded(target.entry_kind(&path)).await?.is_none() {
        return Ok(Some(path));
    }
    match resolution {
        "overwrite" => Ok(Some(path)),
        "rename" => Ok(Some(bounded(auto_rename(target, &path)).await?)),
        "skip" => Ok(None),
        _ => Err(
            CommandError::new("PATH_EXISTS", format!("目标已存在：{path}"))
                .with_details(serde_json::json!({"dest_path":path})),
        ),
    }
}
impl ResumableTransfers {
    pub fn new(repository: TransferRepository) -> Result<Self, CommandError> {
        let root = repository.storage_root()?;
        let records = repository
            .list()?
            .into_iter()
            .map(|r| (r.task.id.clone(), Arc::new(Mutex::new(r))))
            .collect();
        Ok(Self {
            records: Arc::new(RwLock::new(records)),
            controls: Arc::new(Mutex::new(HashMap::new())),
            workers: Arc::new(Mutex::new(HashMap::new())),
            uploads: Arc::new(Mutex::new(HashMap::new())),
            operations: Arc::new(Mutex::new(())),
            repository,
            semaphore: Arc::new(Semaphore::new(if cfg!(mobile) { 2 } else { 5 })),
            root,
            emitted: Arc::new(std::sync::Mutex::new(HashMap::new())),
            #[cfg(test)]
            write_fault: Arc::new(Mutex::new(None)),
        })
    }
    async fn entry(&self, id: &str) -> Result<Entry, CommandError> {
        self.records
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| CommandError::new("NOT_FOUND", "传输任务不存在"))
    }
    fn save(
        &self,
        record: &TransferRecord,
        events: &dyn SftpEventSink,
    ) -> Result<(), CommandError> {
        self.repository.save(record)?;
        self.emit_snapshot(record, events)
    }
    fn save_checkpoint(
        &self,
        record: &TransferRecord,
        index: usize,
        events: &dyn SftpEventSink,
    ) -> Result<(), CommandError> {
        self.repository.save_checkpoint(record, index)?;
        self.emit_snapshot(record, events)
    }
    fn emit_snapshot(
        &self,
        record: &TransferRecord,
        events: &dyn SftpEventSink,
    ) -> Result<(), CommandError> {
        let now = Instant::now();
        let mut emitted = self.emitted.lock().expect("transfer event clock");
        if let Some(previous) = emitted.get(&record.task.id) {
            if previous.generation == record.task.execution_generation
                && previous.status == record.task.status
                && !(previous.bytes == 0 && record.task.transferred > 0)
                && now.saturating_duration_since(previous.at) < Duration::from_millis(200)
            {
                return Ok(());
            }
        }
        emitted.insert(
            record.task.id.clone(),
            EmittedProgress {
                at: now,
                generation: record.task.execution_generation,
                status: record.task.status.clone(),
                bytes: record.task.transferred,
            },
        );
        drop(emitted);
        let mut payload = serde_json::to_value(&record.task).map_err(CommandError::database)?;
        payload["task_id"] = serde_json::json!(record.task.id);
        let kind = match record.task.status.as_str() {
            "queued" | "transferring" => "transfer_progress",
            "completed" | "cancelled" => "transfer_complete",
            "failed" => "transfer_failed",
            _ => "transfer_updated",
        };
        events.emit_sftp(kind, payload);
        Ok(())
    }
    pub async fn list(&self, session: Option<&str>, status: Option<&str>) -> Vec<TransferTask> {
        let entries: Vec<_> = self.records.read().await.values().cloned().collect();
        let mut tasks = Vec::new();
        for entry in entries {
            let record = entry.lock().await;
            if session.is_none_or(|s| record.session_ids.iter().any(|id| id == s))
                && status.is_none_or(|s| s == record.task.status)
            {
                tasks.push(record.task.clone())
            }
        }
        tasks.sort_by_key(|t| std::cmp::Reverse(t.started_at));
        tasks
    }
    pub async fn create(
        &self,
        mut descriptor: TransferDescriptor,
        file_name: String,
        direction: &str,
        size: u64,
        events: &dyn SftpEventSink,
    ) -> Result<TransferTask, CommandError> {
        let id = format!("rt-{}", uuid::Uuid::new_v4());
        if let TransferDescriptor::Download { artifact, .. } = &mut descriptor {
            if artifact.is_empty() {
                *artifact = self.artifact_path(&id, &file_name);
            }
        }
        let mut task = TransferTask::new(id.clone(), file_name, direction, size);
        match &descriptor {
            TransferDescriptor::Copy {
                source_profile,
                target_profile,
                ..
            } => {
                task.source_profile = source_profile.clone();
                task.target_profile = target_profile.clone();
            }
            TransferDescriptor::Download { source_profile, .. } => {
                task.source_profile = source_profile.clone();
                task.target_profile = "local".into();
            }
            TransferDescriptor::Upload { target_profile, .. } => {
                task.source_profile = "browser".into();
                task.target_profile = target_profile.clone();
            }
        }
        let record = TransferRecord {
            task: task.clone(),
            descriptor,
            files: vec![],
            temporary_paths: vec![],
            prepared: false,
            directories: vec![],
            archives: vec![],
            session_ids: vec![],
            pending_cleanup: false,
        };
        self.save(&record, events)?;
        self.records
            .write()
            .await
            .insert(id, Arc::new(Mutex::new(record)));
        Ok(task)
    }
    async fn resolve(
        &self,
        state: &SftpService,
        record: &TransferRecord,
    ) -> Result<(Backends, Vec<String>), CommandError> {
        let mut profiles = HashSet::from(["local".to_string()]);
        for file in &record.files {
            profiles.insert(file.source_profile.clone());
            profiles.insert(file.target_profile.clone());
        }
        match &record.descriptor {
            TransferDescriptor::Copy {
                source_profile,
                target_profile,
                ..
            } => {
                profiles.insert(source_profile.clone());
                profiles.insert(target_profile.clone());
            }
            TransferDescriptor::Download { source_profile, .. } => {
                profiles.insert(source_profile.clone());
            }
            TransferDescriptor::Upload { target_profile, .. } => {
                profiles.insert(target_profile.clone());
            }
        }
        profiles.remove("browser");
        let mut backends = Backends::new();
        let mut sessions = Vec::new();
        for profile in profiles {
            if profile == "local" {
                if let Ok((id, _)) = state.backend_for_profile(&profile).await {
                    sessions.push(id);
                }
                backends.insert(profile, Arc::new(FileBackend::Local));
            } else {
                let (id, target) = state.backend_for_profile(&profile).await?;
                sessions.push(id);
                backends.insert(profile, target);
            }
        }
        Ok((backends, sessions))
    }
    pub async fn resume(
        &self,
        state: &SftpService,
        id: &str,
        restart: bool,
    ) -> Result<TransferTask, CommandError> {
        let _operation = self.operations.lock().await;
        let entry = self.entry(id).await?;
        let record = entry.lock().await.clone();
        if let TransferDescriptor::Upload { .. } = record.descriptor {
            return Err(CommandError::new(
                "SOURCE_REQUIRED",
                "请选择原上传文件并校验后继续",
            ));
        }
        let (backends, sessions) = self.resolve(state, &record).await?;
        self.start(entry, backends, sessions, restart, state.events.clone())
            .await
    }
    async fn start(
        &self,
        entry: Entry,
        backends: Backends,
        sessions: Vec<String>,
        restart: bool,
        events: Arc<dyn SftpEventSink>,
    ) -> Result<TransferTask, CommandError> {
        let id = entry.lock().await.task.id.clone();
        if self
            .workers
            .lock()
            .await
            .get(&id)
            .is_some_and(|w| !w.is_finished())
        {
            return Err(CommandError::new("TRANSFER_BUSY", "任务已经在执行"));
        }
        if let Some(worker) = self.workers.lock().await.remove(&id) {
            let _ = worker.await;
        }
        let mut record = entry.lock().await;
        if matches!(record.task.status.as_str(), "completed" | "cancelled") {
            return Err(CommandError::new("TRANSFER_FINISHED", "该任务已经结束"));
        }
        if restart {
            self.cleanup(&mut record, &backends).await?;
            record.files.clear();
            record.archives.clear();
            record.directories.clear();
            record.temporary_paths.clear();
            record.prepared = false;
            record.task.transferred = 0;
            record.task.confirmed_offset = 0;
        }
        record.task.execution_generation += 1;
        record.task.status = "queued".into();
        record.task.error_code.clear();
        record.task.error_message.clear();
        record.task.finished_at = None;
        record.task.retryable = false;
        record.session_ids = sessions;
        self.save(&record, events.as_ref())?;
        let task = record.task.clone();
        drop(record);
        let control = Arc::new(Control::new());
        self.controls
            .lock()
            .await
            .insert(id.clone(), control.clone());
        let manager = self.clone();
        let owned_entry = entry.clone();
        let worker = tokio::spawn(async move {
            let result=async {
                let permit=tokio::select! { _=control.stop.cancelled()=>return Err(CommandError::new("TRANSFER_STOPPED","任务已停止")), p=manager.semaphore.clone().acquire_owned()=>p.map_err(|_|CommandError::new("TRANSFER_STOPPED","任务管理器已停止"))? };
                { let mut record=owned_entry.lock().await; record.task.status="transferring".into(); manager.save(&record,events.as_ref())?; }
                let result=manager.run(&owned_entry,&backends,&control,events.as_ref()).await;
                drop(permit); result
            }.await;
            let mut record = owned_entry.lock().await;
            record.task.speed = 0;
            match result {
                Ok(()) => {
                    record.task.status = "completed".into();
                    record.task.finished_at = Some(chrono::Utc::now().timestamp_millis());
                    record.task.transferred = record.task.size;
                    record.task.confirmed_offset = record.task.size;
                }
                Err(_error) if control.requested.load(Ordering::Acquire) != 0 => {
                    record.task.status = "paused".into();
                    record.task.retryable = true;
                    record.task.error_code.clear();
                    record.task.error_message.clear();
                }
                Err(error) => {
                    record.task.status = "failed".into();
                    record.task.retryable = error.retryable;
                    record.task.error_code = error.code.into();
                    record.task.error_message = error.message;
                }
            }
            if let Err(error) = manager.save(&record, events.as_ref()) {
                record.task.status = "recoverable".into();
                record.task.error_code = error.code.into();
                record.task.error_message = "检查点保存失败，继续前将重新核对文件".into();
                record.task.retryable = true;
                let _ = manager.emit_snapshot(&record, events.as_ref());
            }
        });
        self.workers.lock().await.insert(id, worker);
        Ok(task)
    }
    async fn prepare(
        &self,
        entry: &Entry,
        backends: &Backends,
        control: &Control,
        events: &dyn SftpEventSink,
    ) -> Result<(), CommandError> {
        let mut record = entry.lock().await.clone();
        if record.prepared {
            return Ok(());
        }
        let root = self.root.join(&record.task.id);
        let root_api = local_path_to_api(&root);
        record.temporary_paths = vec![root_api.clone()];
        self.save(&record, events)?;
        *entry.lock().await = record.clone();
        std::fs::create_dir_all(&root).map_err(CommandError::database)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o700))
                .map_err(CommandError::database)?;
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))
                .map_err(CommandError::database)?;
        }
        let mut files = Vec::new();
        let mut directories = Vec::new();
        let mut archives = Vec::new();
        match record.descriptor.clone() {
            TransferDescriptor::Copy {
                source_profile,
                target_profile,
                paths,
                destination: destination_dir,
                resolution,
                directory_mode,
            } => {
                for (index, path) in paths.iter().enumerate() {
                    stopped(control)?;
                    let source = backend(backends, &source_profile)?;
                    let info = bounded(source.stat(path)).await?;
                    let target = backend(backends, &target_profile)?;
                    let wanted = join_path(
                        &destination_dir,
                        &if info.is_dir && directory_mode == "archive" {
                            archive_name(path)
                        } else {
                            info.name.clone()
                        },
                    );
                    if info.is_dir && directory_mode == "preserve" {
                        let final_path = if bounded(target.entry_kind(&wanted)).await?.is_some() {
                            match resolution.as_str() {
                                "skip" => continue,
                                "rename" => bounded(auto_rename(target, &wanted)).await?,
                                "overwrite" => wanted,
                                _ => {
                                    return Err(CommandError::new("PATH_EXISTS", "目标目录已存在"))
                                }
                            }
                        } else {
                            wanted
                        };
                        self.scan(
                            backends,
                            &source_profile,
                            path,
                            &target_profile,
                            &final_path,
                            &resolution,
                            &record.task.id,
                            control,
                            &mut files,
                            &mut directories,
                        )
                        .await?;
                    } else if info.is_dir {
                        let Some(final_path) = destination(target, wanted, &resolution).await?
                        else {
                            continue;
                        };
                        let spool =
                            join_path(&root_api, &format!("archive-{index}/{}", base_name(path)));
                        self.scan(
                            backends,
                            &source_profile,
                            path,
                            "local",
                            &spool,
                            "overwrite",
                            &record.task.id,
                            control,
                            &mut files,
                            &mut directories,
                        )
                        .await?;
                        archives.push(ArchiveCheckpoint {
                            source_root: spool,
                            output: join_path(&root_api, &format!("archive-{index}.tar.gz")),
                            format: "tar.gz".into(),
                            target_profile: Some(target_profile.clone()),
                            original_target: signature(target, &final_path, Some(control)).await?,
                            target: final_path,
                            generated: false,
                        });
                    } else if let Some(final_path) =
                        destination(target, wanted, &resolution).await?
                    {
                        files.push(
                            self.checkpoint(
                                backends,
                                &source_profile,
                                path,
                                &target_profile,
                                &final_path,
                                &record.task.id,
                                control,
                            )
                            .await?,
                        );
                    }
                }
            }
            TransferDescriptor::Download {
                source_profile,
                paths,
                artifact,
            } => {
                let source = backend(backends, &source_profile)?;
                let zipped = paths.len() != 1 || bounded(source.stat(&paths[0])).await?.is_dir;
                if zipped {
                    let spool = join_path(&root_api, "download-source");
                    directories.push(("local".into(), spool.clone()));
                    for path in &paths {
                        self.scan(
                            backends,
                            &source_profile,
                            path,
                            "local",
                            &join_path(&spool, &base_name(path)),
                            "overwrite",
                            &record.task.id,
                            control,
                            &mut files,
                            &mut directories,
                        )
                        .await?;
                    }
                    archives.push(ArchiveCheckpoint {
                        source_root: spool,
                        output: artifact.clone(),
                        format: "zip".into(),
                        target_profile: None,
                        target: artifact,
                        original_target: None,
                        generated: false,
                    });
                } else {
                    files.push(
                        self.checkpoint(
                            backends,
                            &source_profile,
                            &paths[0],
                            "local",
                            &artifact,
                            &record.task.id,
                            control,
                        )
                        .await?,
                    );
                }
            }
            TransferDescriptor::Upload { .. } => {
                return Err(CommandError::new("SOURCE_REQUIRED", "上传需要文件引用"))
            }
        }
        let mut destinations = HashSet::new();
        for file in &files {
            if !destinations.insert((&file.target_profile, &file.target)) {
                return Err(CommandError::new("INVALID_DESTINATION", "任务包含重复目标"));
            }
        }
        record.task.size = files.iter().map(|f| f.size).sum();
        record.files = files;
        record.directories = directories;
        record.archives = archives;
        record.prepared = true;
        self.save(&record, events)?;
        *entry.lock().await = record;
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    async fn scan(
        &self,
        backends: &Backends,
        source_profile: &str,
        source_path: &str,
        target_profile: &str,
        target_path: &str,
        resolution: &str,
        id: &str,
        control: &Control,
        files: &mut Vec<FileCheckpoint>,
        directories: &mut Vec<(String, String)>,
    ) -> Result<(), CommandError> {
        let source = backend(backends, source_profile)?;
        let target = backend(backends, target_profile)?;
        let mut pending = vec![(source_path.to_owned(), target_path.to_owned())];
        while let Some((source_path, target_path)) = pending.pop() {
            stopped(control)?;
            if bounded(source.entry_kind(&source_path)).await? == Some(true) {
                return Err(CommandError::new(
                    "TRANSFER_SYMLINK",
                    "目录含符号链接，请单独处理",
                ));
            }
            let info = bounded(source.stat(&source_path)).await?;
            if info.is_dir {
                directories.push((target_profile.into(), target_path.clone()));
                let mut children = bounded(source.list(&source_path)).await?;
                children.sort_by(|a, b| b.name.cmp(&a.name));
                for child in children {
                    pending.push((child.path, join_path(&target_path, &child.name)));
                }
            } else if let Some(final_path) = destination(target, target_path, resolution).await? {
                files.push(
                    self.checkpoint(
                        backends,
                        source_profile,
                        &source_path,
                        target_profile,
                        &final_path,
                        id,
                        control,
                    )
                    .await?,
                );
            }
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    async fn checkpoint(
        &self,
        backends: &Backends,
        source_profile: &str,
        source_path: &str,
        target_profile: &str,
        target_path: &str,
        id: &str,
        control: &Control,
    ) -> Result<FileCheckpoint, CommandError> {
        let source = backend(backends, source_profile)?;
        if bounded(source.entry_kind(source_path)).await? == Some(true) {
            return Err(CommandError::new("TRANSFER_SYMLINK", "源文件是符号链接"));
        }
        let info = bounded(source.stat(source_path)).await?;
        let target = backend(backends, target_profile)?;
        let original_target = signature(target, target_path, Some(control)).await?;
        if original_target.is_some() && !target.supports_atomic_replace() {
            return Err(CommandError::new(
                "ATOMIC_SAVE_UNSUPPORTED",
                "服务器不支持安全替换，请选择重命名",
            ));
        }
        Ok(FileCheckpoint {
            source_profile: source_profile.into(),
            source: source_path.into(),
            target_profile: target_profile.into(),
            target: target_path.into(),
            stage: join_path(
                &parent_path(target_path),
                &format!(".eizhu-transfer-{id}-{}", uuid::Uuid::new_v4()),
            ),
            size: info.size,
            modified: format_time(info.modified),
            original_target,
            blocks: vec![],
            confirmed_offset: 0,
            committed: false,
            committing: false,
        })
    }
    async fn run(
        &self,
        entry: &Entry,
        backends: &Backends,
        control: &Control,
        events: &dyn SftpEventSink,
    ) -> Result<(), CommandError> {
        self.prepare(entry, backends, control, events).await?;
        let record = entry.lock().await.clone();
        for (profile, path) in &record.directories {
            stopped(control)?;
            bounded(backend(backends, profile)?.mkdir_all(path)).await?;
        }
        // Verify every checkpoint, including committed files in a directory, before continuing.
        for (index, file) in record.files.iter().enumerate() {
            stopped(control)?;
            let target = backend(backends, &file.target_profile)?;
            if file.committing && bounded(target.entry_kind(&file.stage)).await?.is_none() {
                if file.confirmed_offset != file.size {
                    return Err(CommandError::new(
                        "CHECKPOINT_INVALID",
                        "提交检查点未完整确认",
                    ));
                }
                let mut committed = file.clone();
                committed.committed = true;
                committed.committing = false;
                self.verify(&committed, backends, Some(control)).await?;
                let mut record = entry.lock().await;
                let mut next = record.clone();
                next.files[index] = committed;
                self.save(&next, events)?;
                *record = next;
            } else if file.confirmed_offset > 0 || file.committed {
                self.verify(file, backends, Some(control)).await?;
            }
        }
        let mut meter = SpeedMeter::new(Instant::now());
        loop {
            stopped(control)?;
            let record = entry.lock().await.clone();
            if let Some(index) = record.files.iter().position(|f| !f.committed) {
                self.copy_file(entry, index, backends, control, events, &mut meter)
                    .await?;
                continue;
            }
            if let Some(index) = record.archives.iter().position(|a| !a.generated) {
                let archive = record.archives[index].clone();
                let source = crate::infrastructure::platform::local_files::path_from_api(
                    &archive.source_root,
                );
                let output =
                    crate::infrastructure::platform::local_files::path_from_api(&archive.output);
                let token = control.stop.clone();
                let format = archive.format.clone();
                let result = tokio::task::spawn_blocking(move || {
                    if output.exists() {
                        std::fs::remove_file(&output)
                            .map_err(|e| SftpError::from(e.to_string()))?;
                    }
                    if format == "zip" {
                        make_zip_from_directory(&source, &output, &token)
                    } else {
                        make_tar_gz_from_directory(&source, &output, &token)
                    }
                })
                .await
                .map_err(CommandError::database)?
                .map_err(io_error);
                if result.is_err() {
                    let _ = tokio::fs::remove_file(
                        crate::infrastructure::platform::local_files::path_from_api(
                            &archive.output,
                        ),
                    )
                    .await;
                }
                result?;
                stopped(control)?;
                let mut next = entry.lock().await.clone();
                if let Some(profile) = &archive.target_profile {
                    let mut checkpoint = self
                        .checkpoint(
                            backends,
                            "local",
                            &archive.output,
                            profile,
                            &archive.target,
                            &next.task.id,
                            control,
                        )
                        .await?;
                    checkpoint.original_target = archive.original_target;
                    next.task.size += checkpoint.size;
                    next.files.push(checkpoint);
                } else {
                    next.task.size = bounded(FileBackend::Local.stat(&archive.output))
                        .await?
                        .size;
                }
                next.archives[index].generated = true;
                self.save(&next, events)?;
                *entry.lock().await = next;
                continue;
            }
            return Ok(());
        }
    }
    async fn verify(
        &self,
        file: &FileCheckpoint,
        backends: &Backends,
        control: Option<&Control>,
    ) -> Result<(), CommandError> {
        let source = backend(backends, &file.source_profile)?;
        let target = backend(backends, &file.target_profile)?;
        let info = bounded(source.stat(&file.source)).await?;
        if info.size != file.size || format_time(info.modified) != file.modified {
            return Err(CommandError::new(
                "SOURCE_CHANGED",
                "源文件大小或修改时间已变化，请重新开始",
            ));
        }
        let path = if file.committed {
            &file.target
        } else {
            &file.stage
        };
        let mut offset = 0;
        for block in &file.blocks {
            if let Some(control) = control {
                stopped(control)?;
            }
            if block.length == 0 || block.length > BLOCK_SIZE as u64 {
                return Err(CommandError::new("CHECKPOINT_INVALID", "分块检查点无效"));
            }
            let original =
                bounded(source.read_chunk_at(&file.source, offset, block.length as usize)).await?;
            let staged = bounded(target.read_chunk_at(path, offset, block.length as usize)).await?;
            if hex::encode(Sha256::digest(&original)) != block.sha256 {
                return Err(CommandError::new(
                    "SOURCE_CHANGED",
                    "已传部分的源内容变化，请重新开始",
                ));
            }
            if hex::encode(Sha256::digest(&staged)) != block.sha256 {
                return Err(CommandError::new(
                    "STAGING_CHANGED",
                    "暂存文件内容不一致，请重新开始",
                ));
            }
            offset += block.length;
        }
        if offset != file.confirmed_offset || offset > file.size {
            return Err(CommandError::new("CHECKPOINT_INVALID", "检查点偏移不一致"));
        }
        if file.committed {
            if bounded(target.stat(path)).await?.size != file.size {
                return Err(CommandError::new(
                    "TARGET_CHANGED",
                    "已完成的目标文件变化，请检查后重新开始",
                ));
            }
        } else {
            bounded(target.truncate(path, offset)).await?;
        }
        Ok(())
    }
    async fn copy_file(
        &self,
        entry: &Entry,
        index: usize,
        backends: &Backends,
        control: &Control,
        events: &dyn SftpEventSink,
        meter: &mut SpeedMeter,
    ) -> Result<(), CommandError> {
        let mut file = entry.lock().await.files[index].clone();
        let source = backend(backends, &file.source_profile)?;
        let target = backend(backends, &file.target_profile)?;
        bounded(target.mkdir_all(&parent_path(&file.target))).await?;
        if bounded(target.entry_kind(&file.stage)).await?.is_none() {
            if file.confirmed_offset != 0 {
                return Err(CommandError::new(
                    "STAGING_CHANGED",
                    "暂存文件缺失，请重新开始",
                ));
            }
            bounded(target.write_private_new(&file.stage, &[])).await?;
        } else {
            self.verify(&file, backends, Some(control)).await?;
        }
        let info = bounded(source.stat(&file.source)).await?;
        if info.size != file.size || format_time(info.modified) != file.modified {
            return Err(CommandError::new(
                "SOURCE_CHANGED",
                "源文件已变化，请重新开始",
            ));
        }
        while file.confirmed_offset < file.size {
            stopped(control)?;
            let length = BLOCK_SIZE.min((file.size - file.confirmed_offset) as usize);
            let bytes =
                bounded(source.read_chunk_at(&file.source, file.confirmed_offset, length)).await?;
            #[cfg(test)]
            if let Some(error) = self.write_fault.lock().await.take() {
                return Err(error);
            }
            bounded(target.write_chunk_at(&file.stage, file.confirmed_offset, &bytes[..length]))
                .await?;
            file.blocks.push(BlockDigest {
                length: length as u64,
                sha256: hex::encode(Sha256::digest(&bytes[..length])),
            });
            file.confirmed_offset += length as u64;
            let mut record = entry.lock().await;
            let mut next = record.clone();
            next.files[index] = file.clone();
            next.task.transferred = next.files.iter().map(|f| f.confirmed_offset).sum();
            next.task.confirmed_offset = next.task.transferred;
            next.task.speed = meter.record(next.task.transferred, Instant::now());
            self.save_checkpoint(&next, index, events)?;
            *record = next;
        }
        stopped(control)?;
        self.verify(&file, backends, Some(control)).await?;
        file.committing = true;
        {
            let mut record = entry.lock().await;
            let mut next = record.clone();
            next.files[index] = file.clone();
            self.save_checkpoint(&next, index, events)?;
            *record = next;
        }
        self.commit(&file, target, Some(control)).await?;
        let mut record = entry.lock().await;
        let mut next = record.clone();
        next.files[index].committed = true;
        next.files[index].committing = false;
        self.save_checkpoint(&next, index, events)?;
        *record = next;
        Ok(())
    }
    async fn commit(
        &self,
        file: &FileCheckpoint,
        target: &FileBackend,
        control: Option<&Control>,
    ) -> Result<(), CommandError> {
        if signature(target, &file.target, control).await? != file.original_target {
            return Err(CommandError::new(
                "TARGET_CHANGED",
                "目标文件在传输期间变化，请检查冲突后重新开始",
            ));
        }
        if file.original_target.is_some() {
            bounded(target.copy_permissions(&file.target, &file.stage)).await?;
        }
        bounded(target.commit_staged(&file.stage, &file.target, file.original_target.is_some()))
            .await
    }
    pub async fn pause(
        &self,
        id: &str,
        events: &dyn SftpEventSink,
    ) -> Result<TransferTask, CommandError> {
        let _operation = self.operations.lock().await;
        self.pause_inner(id, events).await
    }
    async fn pause_inner(
        &self,
        id: &str,
        events: &dyn SftpEventSink,
    ) -> Result<TransferTask, CommandError> {
        let entry = self.entry(id).await?;
        if let Some(control) = self.controls.lock().await.get(id).cloned() {
            control.requested.store(1, Ordering::Release);
            control.stop.cancel();
        }
        if let Some(worker) = self.workers.lock().await.remove(id) {
            let _ = worker.await;
        }
        self.uploads
            .lock()
            .await
            .retain(|_, handle| !Arc::ptr_eq(&handle.entry, &entry));
        let mut record = entry.lock().await;
        if let Some(control) = self.controls.lock().await.get(id).cloned() {
            control.permit.lock().await.take();
        }
        if !matches!(record.task.status.as_str(), "completed" | "cancelled") {
            record.task.status = "paused".into();
            record.task.speed = 0;
            record.task.retryable = true;
            self.save(&record, events)?;
        }
        Ok(record.task.clone())
    }
    pub async fn shutdown(&self, events: &dyn SftpEventSink) {
        let _operation = self.operations.lock().await;
        let ids: Vec<_> = self.controls.lock().await.keys().cloned().collect();
        // Signal all tasks first so shutdown does not wait for every task serially.
        for control in self.controls.lock().await.values() {
            control.requested.store(1, Ordering::Release);
            control.stop.cancel();
        }
        for id in ids {
            let _ = self.pause_inner(&id, events).await;
        }
    }
    pub async fn pause_session(&self, session: &str, events: &dyn SftpEventSink) {
        for task in self.list(Some(session), None).await {
            let _ = self.pause(&task.id, events).await;
        }
    }
    async fn cleanup(
        &self,
        record: &mut TransferRecord,
        backends: &Backends,
    ) -> Result<(), CommandError> {
        let mut failures = Vec::new();
        for file in &record.files {
            if !file.committed {
                match backend(backends, &file.target_profile) {
                    Ok(target) => {
                        if !base_name(&file.stage)
                            .starts_with(&format!(".eizhu-transfer-{}-", record.task.id))
                            || parent_path(&file.stage) != parent_path(&file.target)
                        {
                            return Err(CommandError::new(
                                "CHECKPOINT_INVALID",
                                "暂存文件不属于当前任务",
                            ));
                        }
                        match bounded(target.entry_kind(&file.stage)).await {
                            Ok(Some(_)) => {
                                if let Err(error) = bounded(target.remove_file(&file.stage)).await {
                                    failures.push(error.message)
                                }
                            }
                            Ok(None) => (),
                            Err(error) => failures.push(error.message),
                        }
                    }
                    Err(e) => failures.push(e.message),
                }
            }
        }
        for path in &record.temporary_paths {
            let path = crate::infrastructure::platform::local_files::path_from_api(path);
            if !path.starts_with(&self.root) || path == self.root {
                return Err(CommandError::new(
                    "CHECKPOINT_INVALID",
                    "暂存目录不属于当前空间",
                ));
            }
            if path.exists() {
                if let Err(e) = tokio::fs::remove_dir_all(path).await {
                    failures.push(e.to_string())
                }
            }
        }
        record.pending_cleanup = !failures.is_empty();
        if record.pending_cleanup {
            Err(CommandError::new(
                "CLEANUP_REQUIRED",
                format!(
                    "暂存文件尚未清理，请连接后再次取消：{}",
                    failures.join("；")
                ),
            )
            .retryable())
        } else {
            Ok(())
        }
    }
    pub async fn cancel(
        &self,
        state: &SftpService,
        id: &str,
    ) -> Result<TransferTask, CommandError> {
        let _operation = self.operations.lock().await;
        self.pause_inner(id, state.events.as_ref()).await?;
        let entry = self.entry(id).await?;
        let mut record = entry.lock().await;
        if record.task.status == "completed" {
            return Ok(record.task.clone());
        }
        let (backends, _) = self.resolve(state, &record).await.unwrap_or_else(|_| {
            (
                Backends::from([("local".into(), Arc::new(FileBackend::Local))]),
                vec![],
            )
        });
        let result = self.cleanup(&mut record, &backends).await;
        record.task.status = "cancelled".into();
        record.task.finished_at = Some(chrono::Utc::now().timestamp_millis());
        record.task.retryable = false;
        if let Err(error) = &result {
            record.task.error_code = error.code.into();
            record.task.error_message = error.message.clone();
        }
        self.save(&record, state.events.as_ref())?;
        result?;
        Ok(record.task.clone())
    }
    pub async fn clear_completed(&self, state: &SftpService) -> Result<(), CommandError> {
        let _operation = self.operations.lock().await;
        let entries: Vec<_> = self.records.read().await.values().cloned().collect();
        for entry in entries {
            let mut record = entry.lock().await;
            if matches!(record.task.status.as_str(), "completed" | "cancelled")
                && !record.pending_cleanup
            {
                let (backends, _) = self.resolve(state, &record).await.unwrap_or_else(|_| {
                    (
                        Backends::from([("local".into(), Arc::new(FileBackend::Local))]),
                        vec![],
                    )
                });
                self.cleanup(&mut record, &backends).await?;
                self.repository.remove(&record.task.id)?;
                self.records.write().await.remove(&record.task.id);
                self.emitted
                    .lock()
                    .expect("transfer event clock")
                    .remove(&record.task.id);
                self.controls.lock().await.remove(&record.task.id);
                if let Some(worker) = self.workers.lock().await.remove(&record.task.id) {
                    let _ = worker.await;
                }
            }
        }
        Ok(())
    }
    pub async fn download_artifact(&self, id: &str) -> Result<(PathBuf, String), CommandError> {
        let entry = self.entry(id).await?;
        let record = entry.lock().await;
        if record.task.status != "completed" {
            return Err(CommandError::new(
                "TRANSFER_NOT_READY",
                format!("任务当前状态：{}", record.task.status),
            ));
        }
        let TransferDescriptor::Download { artifact, .. } = &record.descriptor else {
            return Err(CommandError::new("NOT_FOUND", "任务不是下载任务"));
        };
        let path = crate::infrastructure::platform::local_files::path_from_api(artifact);
        if !path.is_file() {
            return Err(CommandError::new("NOT_FOUND", "下载暂存已清理"));
        }
        Ok((path, record.task.file_name.clone()))
    }
    pub async fn close_download(&self, id: &str) -> Result<(), CommandError> {
        let (path, _) = self.download_artifact(id).await?;
        tokio::fs::remove_file(path)
            .await
            .map_err(CommandError::database)
    }
    pub fn artifact_path(&self, id: &str, name: &str) -> String {
        local_path_to_api(&self.root.join(id).join(name))
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn begin_upload(
        &self,
        state: &SftpService,
        session_id: &str,
        name: String,
        dir: String,
        resolution: &str,
        size: u64,
        last_modified: Option<u64>,
    ) -> Result<Option<(String, TransferTask)>, CommandError> {
        let _operation = self.operations.lock().await;
        let (session, target) = state.backend(session_id).await?;
        let Some(path) =
            destination(&target, join_path(&clean_path(&dir), &name), resolution).await?
        else {
            return Ok(None);
        };
        let original_target = signature(&target, &path, None).await?;
        if original_target.is_some() && !target.supports_atomic_replace() {
            return Err(CommandError::new(
                "ATOMIC_SAVE_UNSUPPORTED",
                "服务器不支持安全替换，请选择其他文件名",
            ));
        }
        let task = self
            .create(
                TransferDescriptor::Upload {
                    target_profile: session.profile_id.clone(),
                    destination: path.clone(),
                    size,
                    last_modified,
                },
                base_name(&path),
                "upload",
                size,
                state.events.as_ref(),
            )
            .await?;
        let entry = self.entry(&task.id).await?;
        let mut record = entry.lock().await;
        record.session_ids = vec![session_id.into()];
        record.task.execution_generation = 1;
        record.files = vec![FileCheckpoint {
            source_profile: "browser".into(),
            source: name,
            target_profile: session.profile_id.clone(),
            target: path.clone(),
            stage: join_path(
                &parent_path(&path),
                &format!(".eizhu-transfer-{}-{}", task.id, uuid::Uuid::new_v4()),
            ),
            size,
            modified: last_modified.map(|v| v.to_string()).unwrap_or_default(),
            original_target,
            blocks: vec![],
            confirmed_offset: 0,
            committed: false,
            committing: false,
        }];
        record.prepared = true;
        self.save(&record, state.events.as_ref())?;
        let stage = record.files[0].stage.clone();
        drop(record);
        bounded(target.mkdir_all(&parent_path(&stage))).await?;
        if let Err(error) = bounded(target.write_private_new(&stage, &[])).await {
            self.upload_failure(&entry, &error, state.events.as_ref())
                .await?;
            return Err(error);
        }
        let control = Arc::new(Control::new());
        self.controls
            .lock()
            .await
            .insert(task.id.clone(), control.clone());
        drop(_operation);
        let permit = tokio::select! { _=control.stop.cancelled()=>return Err(CommandError::new("TRANSFER_STOPPED","任务已停止")), permit=self.semaphore.clone().acquire_owned()=>permit.map_err(|_|CommandError::new("TRANSFER_STOPPED","任务管理器已停止"))? };
        *control.permit.lock().await = Some(permit);
        self.activate_upload(entry, target, control, state.events.as_ref())
            .await
            .map(Some)
    }
    async fn activate_upload(
        &self,
        entry: Entry,
        target: Arc<FileBackend>,
        control: Arc<Control>,
        events: &dyn SftpEventSink,
    ) -> Result<(String, TransferTask), CommandError> {
        let mut record = entry.lock().await;
        if let Err(error) = stopped(&control) {
            control.permit.lock().await.take();
            return Err(error);
        }
        record.task.status = "transferring".into();
        record.task.error_code.clear();
        record.task.error_message.clear();
        record.task.retryable = false;
        if let Err(error) = self.save(&record, events) {
            control.permit.lock().await.take();
            return Err(error);
        }
        let task = record.task.clone();
        let token = format!(
            "{}:{}:{}",
            task.id,
            task.execution_generation,
            uuid::Uuid::new_v4()
        );
        drop(record);
        self.uploads.lock().await.insert(
            token.clone(),
            UploadHandle {
                entry,
                generation: task.execution_generation,
                target,
                control,
            },
        );
        Ok((token, task))
    }
    async fn upload_failure(
        &self,
        entry: &Entry,
        error: &CommandError,
        events: &dyn SftpEventSink,
    ) -> Result<(), CommandError> {
        let mut record = entry.lock().await;
        record.task.status = "failed".into();
        record.task.retryable = error.retryable;
        record.task.speed = 0;
        record.task.error_code = error.code.into();
        record.task.error_message = error.message.clone();
        self.save(&record, events)
    }
    pub async fn upload_chunk(
        &self,
        token: &str,
        bytes: &[u8],
        sequence: Option<u64>,
        events: &dyn SftpEventSink,
    ) -> Result<u64, CommandError> {
        if bytes.is_empty() || bytes.len() > BLOCK_SIZE {
            return Err(CommandError::new(
                "VALIDATION",
                "上传块必须在 1 B 至 1 MiB 之间",
            ));
        }
        let handle = self
            .uploads
            .lock()
            .await
            .get(token)
            .cloned()
            .ok_or_else(|| CommandError::new("UPLOAD_EXPIRED", "上传已停止，请从任务列表继续"))?;
        let result = async {
            let mut record = handle.entry.lock().await;
            if record.task.execution_generation != handle.generation
                || record.task.status != "transferring"
            {
                return Err(CommandError::new(
                    "TRANSFER_STALE",
                    "忽略旧执行代次的上传块",
                ));
            }
            stopped(&handle.control)?;
            let file = &record.files[0];
            let index = sequence.unwrap_or(file.blocks.len() as u64);
            let digest = hex::encode(Sha256::digest(bytes));
            if index < file.blocks.len() as u64 {
                let block = &file.blocks[index as usize];
                if block.length == bytes.len() as u64 && block.sha256 == digest {
                    return Ok(file.confirmed_offset);
                }
                return Err(CommandError::new(
                    "UPLOAD_BLOCK_MISMATCH",
                    "重复块内容不同，请重新开始",
                ));
            }
            if index != file.blocks.len() as u64 {
                return Err(CommandError::new("UPLOAD_SEQUENCE", "上传块顺序不正确"));
            }
            if bytes.len() as u64 > file.size.saturating_sub(file.confirmed_offset) {
                return Err(CommandError::new(
                    "UPLOAD_SIZE_MISMATCH",
                    "上传数据超出原文件大小",
                ));
            }
            #[cfg(test)]
            if let Some(error) = self.write_fault.lock().await.take() {
                return Err(error);
            }
            bounded(
                handle
                    .target
                    .write_chunk_at(&file.stage, file.confirmed_offset, bytes),
            )
            .await?;
            let mut next = record.clone();
            next.files[0].blocks.push(BlockDigest {
                length: bytes.len() as u64,
                sha256: digest,
            });
            next.files[0].confirmed_offset += bytes.len() as u64;
            next.task.transferred = next.files[0].confirmed_offset;
            next.task.confirmed_offset = next.task.transferred;
            self.save_checkpoint(&next, 0, events)?;
            let offset = next.task.confirmed_offset;
            *record = next;
            Ok(offset)
        }
        .await;
        if let Err(error) = &result {
            if !matches!(error.code, "TRANSFER_STOPPED" | "TRANSFER_STALE") {
                handle.control.permit.lock().await.take();
                self.upload_failure(&handle.entry, error, events).await?;
            }
        }
        result
    }
    pub async fn finish_upload(
        &self,
        token: &str,
        events: &dyn SftpEventSink,
    ) -> Result<TransferTask, CommandError> {
        let handle = self
            .uploads
            .lock()
            .await
            .get(token)
            .cloned()
            .ok_or_else(|| CommandError::new("UPLOAD_EXPIRED", "上传已经停止"))?;
        let result = async {
            let mut record = handle.entry.lock().await;
            if record.task.execution_generation != handle.generation
                || record.task.status != "transferring"
            {
                return Err(CommandError::new("TRANSFER_STALE", "上传执行已结束"));
            }
            stopped(&handle.control)?;
            let file = record.files[0].clone();
            if file.confirmed_offset != file.size {
                return Err(CommandError::new(
                    "UPLOAD_SIZE_MISMATCH",
                    "文件尚未完整上传",
                ));
            }
            self.verify_upload_stage(&file, &handle.target, Some(&handle.control))
                .await?;
            let mut next = record.clone();
            next.files[0].committing = true;
            self.save_checkpoint(&next, 0, events)?;
            *record = next;
            self.commit(&file, &handle.target, Some(&handle.control))
                .await?;
            record.files[0].committed = true;
            record.files[0].committing = false;
            record.task.status = "completed".into();
            record.task.speed = 0;
            record.task.finished_at = Some(chrono::Utc::now().timestamp_millis());
            self.save_checkpoint(&record, 0, events)?;
            Ok(record.task.clone())
        }
        .await;
        handle.control.permit.lock().await.take();
        if result.is_ok() {
            self.uploads.lock().await.remove(token);
        }
        if let Err(error) = &result {
            self.upload_failure(&handle.entry, error, events).await?;
        }
        result
    }
    async fn verify_upload_stage(
        &self,
        file: &FileCheckpoint,
        target: &FileBackend,
        control: Option<&Control>,
    ) -> Result<(), CommandError> {
        let committed = file.committing && bounded(target.entry_kind(&file.stage)).await?.is_none();
        if committed && file.confirmed_offset != file.size {
            return Err(CommandError::new(
                "CHECKPOINT_INVALID",
                "上传提交未完整确认",
            ));
        }
        let path = if committed { &file.target } else { &file.stage };
        let mut offset = 0;
        for block in &file.blocks {
            if let Some(control) = control {
                stopped(control)?;
            }
            if block.length == 0 || block.length > BLOCK_SIZE as u64 {
                return Err(CommandError::new("CHECKPOINT_INVALID", "上传检查点无效"));
            }
            let data = bounded(target.read_chunk_at(path, offset, block.length as usize)).await?;
            if hex::encode(Sha256::digest(data)) != block.sha256 {
                return Err(CommandError::new(
                    "STAGING_CHANGED",
                    "暂存文件已损坏，请重新开始",
                ));
            }
            offset += block.length;
        }
        if offset != file.confirmed_offset || offset > file.size {
            return Err(CommandError::new("CHECKPOINT_INVALID", "上传偏移无效"));
        }
        if committed {
            if bounded(target.stat(path)).await?.size != file.size {
                return Err(CommandError::new("STAGING_CHANGED", "提交后的文件大小变化"));
            }
            Ok(())
        } else {
            bounded(target.truncate(&file.stage, offset)).await
        }
    }
    pub async fn upload_checkpoint(&self, id: &str) -> Result<serde_json::Value, CommandError> {
        let entry = self.entry(id).await?;
        let record = entry.lock().await;
        let TransferDescriptor::Upload {
            size,
            last_modified,
            ..
        } = &record.descriptor
        else {
            return Err(CommandError::new("VALIDATION", "任务不是浏览器上传"));
        };
        Ok(
            serde_json::json!({"size":size,"last_modified":last_modified,"blocks":record.files[0].blocks,"task":record.task}),
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub async fn resume_upload(
        &self,
        state: &SftpService,
        id: &str,
        size: u64,
        last_modified: Option<u64>,
        digests: Vec<String>,
        restart: bool,
    ) -> Result<(String, TransferTask, u64, u64), CommandError> {
        let operation = self.operations.lock().await;
        let entry = self.entry(id).await?;
        let mut record = entry.lock().await;
        if !matches!(
            record.task.status.as_str(),
            "paused" | "failed" | "recoverable"
        ) {
            return Err(CommandError::new("TRANSFER_BUSY", "该任务不能继续"));
        }
        let TransferDescriptor::Upload {
            target_profile,
            size: expected,
            last_modified: modified,
            ..
        } = &record.descriptor
        else {
            return Err(CommandError::new("VALIDATION", "任务不是上传"));
        };
        let profile = target_profile.clone();
        if !restart
            && (size != *expected
                || (modified.is_some() && modified != &last_modified)
                || digests.len() != record.files[0].blocks.len()
                || digests
                    .iter()
                    .zip(&record.files[0].blocks)
                    .any(|(digest, block)| digest != &block.sha256))
        {
            return Err(CommandError::new(
                "SOURCE_CHANGED",
                "所选文件与检查点不一致，请重新开始",
            ));
        }
        let (session, target) = state.backend_for_profile(&profile).await?;
        record.task.execution_generation += 1;
        record.task.status = "queued".into();
        record.session_ids = vec![session];
        self.save(&record, state.events.as_ref())?;
        drop(record);
        let control = Arc::new(Control::new());
        self.controls
            .lock()
            .await
            .insert(id.into(), control.clone());
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let manager = self.clone();
        let events = state.events.clone();
        let owned = entry.clone();
        let worker = tokio::spawn(async move {
            let result=async {
                let permit=tokio::select! {_=control.stop.cancelled()=>return Err(CommandError::new("TRANSFER_STOPPED","任务已停止")),p=manager.semaphore.clone().acquire_owned()=>p.map_err(|_|CommandError::new("TRANSFER_STOPPED","任务管理器已停止"))?};
                *control.permit.lock().await=Some(permit);
                let mut next=owned.lock().await.clone();
                if restart {
                    let backends=Backends::from([(profile.clone(),target.clone()),("local".into(),Arc::new(FileBackend::Local))]);manager.cleanup(&mut next,&backends).await?;stopped(&control)?;
                    let original=signature(&target,&next.files[0].target,Some(&control)).await?;
                    if original.is_some() && !target.supports_atomic_replace() {return Err(CommandError::new("ATOMIC_SAVE_UNSUPPORTED","服务器不支持安全替换，请选择其他文件名"))}
                    next.files[0].original_target=original;next.files[0].blocks.clear();next.files[0].confirmed_offset=0;next.files[0].size=size;next.files[0].committing=false;next.files[0].committed=false;next.files[0].modified=last_modified.map(|v|v.to_string()).unwrap_or_default();next.task.size=size;next.task.transferred=0;next.task.confirmed_offset=0;
                    if let TransferDescriptor::Upload {size:old,last_modified:mtime,..}=&mut next.descriptor {*old=size;*mtime=last_modified;}
                    manager.save(&next,events.as_ref())?;*owned.lock().await=next.clone();
                    bounded(target.write_private_new(&next.files[0].stage,&[])).await?;
                }else {manager.verify_upload_stage(&next.files[0],&target,Some(&control)).await?;}
                stopped(&control)?;
                let offset=next.files[0].confirmed_offset;let sequence=next.files[0].blocks.len() as u64;
                if (next.files[0].committing || next.files[0].committed) && bounded(target.entry_kind(&next.files[0].stage)).await?.is_none() {
                    next.files[0].committed=true;next.files[0].committing=false;next.task.status="completed".into();next.task.finished_at=Some(chrono::Utc::now().timestamp_millis());next.task.error_code.clear();next.task.error_message.clear();next.task.retryable=false;manager.save(&next,events.as_ref())?;*owned.lock().await=next.clone();control.permit.lock().await.take();
                    return Ok((String::new(),next.task,offset,sequence));
                }
                let (token,task)=manager.activate_upload(owned.clone(),target,control.clone(),events.as_ref()).await?;Ok((token,task,offset,sequence))
            }.await;
            if let Err(error) = &result {
                control.permit.lock().await.take();
                if control.requested.load(Ordering::Acquire) != 0 {
                    let mut record = owned.lock().await;
                    record.task.status = "paused".into();
                    record.task.retryable = true;
                    let _ = manager.save(&record, events.as_ref());
                } else {
                    let _ = manager.upload_failure(&owned, error, events.as_ref()).await;
                }
            }
            let _ = sender.send(result);
        });
        self.workers.lock().await.insert(id.into(), worker);
        drop(operation);
        receiver
            .await
            .map_err(|_| CommandError::new("TRANSFER_STOPPED", "任务验证已停止"))?
    }
    pub async fn abort_upload(&self, token: &str, state: &SftpService) -> Result<(), CommandError> {
        let handle = self.uploads.lock().await.get(token).cloned();
        if let Some(handle) = handle {
            let id = handle.entry.lock().await.task.id.clone();
            self.cancel(state, &id).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        audit::AuditRepository,
        infrastructure::database::Database,
        profile::ProfileService,
        vault::{Encryptor, VaultService},
    };
    use tokio::sync::mpsc;
    struct Events(mpsc::UnboundedSender<serde_json::Value>);
    impl SftpEventSink for Events {
        fn emit_sftp(&self, _kind: &'static str, payload: serde_json::Value) {
            let _ = self.0.send(payload);
        }
    }
    struct Fixture {
        dir: tempfile::TempDir,
        service: SftpService,
        session: String,
        db: Database,
        key: Encryptor,
        events: mpsc::UnboundedReceiver<serde_json::Value>,
    }
    async fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::initialize(dir.path().join("db")).unwrap();
        let key = Encryptor::load_or_create(dir.path().join("key")).unwrap();
        let capture = key.clone();
        db.configure_capture(move |v| capture.encrypt(v).map_err(|e| e.to_string()));
        let audit = AuditRepository::new(db.clone());
        let vault = VaultService::new(db.clone(), key.clone(), audit.clone());
        let profile = ProfileService::initialize(db.clone(), key.clone(), vault).unwrap();
        let (tx, rx) = mpsc::unbounded_channel();
        let service = SftpService::new(
            profile,
            audit,
            Arc::new(Events(tx)),
            TransferRepository::new(db.clone(), key.clone()).unwrap(),
        )
        .unwrap();
        let response = super::super::state::create_session(&service, "local".into())
            .await
            .unwrap();
        let session = serde_json::to_value(response).unwrap()["session_id"]
            .as_str()
            .unwrap()
            .to_owned();
        Fixture {
            dir,
            service,
            session,
            db,
            key,
            events: rx,
        }
    }
    async fn copy(f: &Fixture, source: &str, target_dir: &str, mode: &str) -> String {
        super::super::transfer::sftp_transfer(
            &f.service,
            f.session.clone(),
            f.session.clone(),
            vec![source.into()],
            target_dir.into(),
            Some("overwrite".into()),
            Some(mode.into()),
        )
        .await
        .unwrap()
        .task_id
    }
    async fn first_block(f: &mut Fixture, id: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(event) = f.events.recv().await {
                if event["task_id"] == id
                    && event["transferred"].as_u64().unwrap_or(0) >= BLOCK_SIZE as u64
                {
                    break;
                }
            }
        })
        .await
        .unwrap();
    }
    async fn finished(f: &Fixture, id: &str) -> TransferRecord {
        if let Some(worker) = f.service.transfers.workers.lock().await.remove(id) {
            tokio::time::timeout(Duration::from_secs(20), worker)
                .await
                .unwrap()
                .unwrap();
        }
        f.service
            .transfers
            .entry(id)
            .await
            .unwrap()
            .lock()
            .await
            .clone()
    }
    async fn pause_file(f: &mut Fixture) -> (String, PathBuf, PathBuf, Vec<u8>) {
        let source = f.dir.path().join("large.bin");
        let target_dir = f.dir.path().join("target");
        std::fs::create_dir(&target_dir).unwrap();
        let target = target_dir.join("large.bin");
        let content = vec![42; BLOCK_SIZE * 8 + 17];
        tokio::fs::write(&source, &content).await.unwrap();
        tokio::fs::write(&target, b"original").await.unwrap();
        let id = copy(
            f,
            source.to_str().unwrap(),
            target_dir.to_str().unwrap(),
            "preserve",
        )
        .await;
        first_block(f, &id).await;
        let task = f
            .service
            .transfers
            .pause(&id, f.service.events.as_ref())
            .await
            .unwrap();
        assert_eq!(task.status, "paused");
        assert!(task.confirmed_offset > 0 && task.confirmed_offset < task.size);
        assert_eq!(f.service.transfers.semaphore.available_permits(), 5);
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"original");
        (id, source, target, content)
    }
    #[tokio::test]
    async fn pause_restart_resume_preserves_original_and_authoritative_checkpoint() {
        let mut f = fixture().await;
        let (id, _, target, content) = pause_file(&mut f).await;
        let prior = f
            .service
            .transfers
            .entry(&id)
            .await
            .unwrap()
            .lock()
            .await
            .clone();
        assert!(PathBuf::from(&prior.files[0].stage).exists());
        f.service.transfers =
            ResumableTransfers::new(TransferRepository::new(f.db.clone(), f.key.clone()).unwrap())
                .unwrap();
        assert_eq!(
            f.service.transfers.list(None, None).await[0].status,
            "paused"
        );
        let resumed = f
            .service
            .transfers
            .resume(&f.service, &id, false)
            .await
            .unwrap();
        assert!(resumed.execution_generation > prior.task.execution_generation);
        let record = finished(&f, &id).await;
        assert_eq!(record.task.status, "completed");
        assert_eq!(tokio::fs::read(target).await.unwrap(), content);
        assert!(!PathBuf::from(&record.files[0].stage).exists());
        assert_eq!(f.service.transfers.semaphore.available_permits(), 5);
    }
    #[tokio::test]
    async fn changed_source_prefix_is_rejected_even_with_identical_size_and_timestamp() {
        let mut f = fixture().await;
        let (id, source, target, mut content) = pause_file(&mut f).await;
        let timestamp = std::fs::metadata(&source).unwrap().modified().unwrap();
        content[0] = 99;
        tokio::fs::write(&source, &content).await.unwrap();
        std::fs::File::options()
            .write(true)
            .open(&source)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(timestamp))
            .unwrap();
        f.service
            .transfers
            .resume(&f.service, &id, false)
            .await
            .unwrap();
        let failed = finished(&f, &id).await;
        assert_eq!(failed.task.error_code, "SOURCE_CHANGED");
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"original");
        f.service
            .transfers
            .resume(&f.service, &id, true)
            .await
            .unwrap();
        assert_eq!(finished(&f, &id).await.task.status, "completed");
        assert_eq!(tokio::fs::read(target).await.unwrap(), content);
    }
    #[tokio::test]
    async fn staging_corruption_stops_resume_and_cancellation_cleans_owned_files() {
        let mut f = fixture().await;
        let (id, _, target, _) = pause_file(&mut f).await;
        let record = f
            .service
            .transfers
            .entry(&id)
            .await
            .unwrap()
            .lock()
            .await
            .clone();
        FileBackend::Local
            .write_chunk_at(&record.files[0].stage, 0, b"bad")
            .await
            .unwrap();
        f.service
            .transfers
            .resume(&f.service, &id, false)
            .await
            .unwrap();
        assert_eq!(finished(&f, &id).await.task.error_code, "STAGING_CHANGED");
        assert_eq!(tokio::fs::read(target).await.unwrap(), b"original");
        assert_eq!(
            f.service
                .transfers
                .cancel(&f.service, &id)
                .await
                .unwrap()
                .status,
            "cancelled"
        );
        assert!(!PathBuf::from(&record.files[0].stage).exists());
        assert_eq!(f.service.transfers.semaphore.available_permits(), 5);
    }
    #[tokio::test]
    async fn browser_upload_validates_prefix_deduplicates_blocks_and_releases_permits() {
        let f = fixture().await;
        let dir = f.dir.path().join("upload");
        tokio::fs::create_dir(&dir).await.unwrap();
        let target = dir.join("data.bin");
        tokio::fs::write(&target, b"original").await.unwrap();
        let (token, task) = f
            .service
            .transfers
            .begin_upload(
                &f.service,
                &f.session,
                "data.bin".into(),
                dir.display().to_string(),
                "overwrite",
                8,
                Some(42),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            f.service
                .transfers
                .upload_chunk(&token, b"abcd", Some(0), f.service.events.as_ref())
                .await
                .unwrap(),
            4
        );
        assert_eq!(
            f.service
                .transfers
                .upload_chunk(&token, b"abcd", Some(0), f.service.events.as_ref())
                .await
                .unwrap(),
            4
        );
        f.service
            .transfers
            .pause(&task.id, f.service.events.as_ref())
            .await
            .unwrap();
        assert_eq!(f.service.transfers.semaphore.available_permits(), 5);
        assert!(f
            .service
            .transfers
            .upload_chunk(&token, b"efgh", Some(1), f.service.events.as_ref())
            .await
            .is_err());
        assert_eq!(
            f.service
                .transfers
                .resume_upload(
                    &f.service,
                    &task.id,
                    8,
                    Some(42),
                    vec!["wrong".into()],
                    false
                )
                .await
                .unwrap_err()
                .code,
            "SOURCE_CHANGED"
        );
        let (token, next, offset, sequence) = f
            .service
            .transfers
            .resume_upload(
                &f.service,
                &task.id,
                8,
                Some(42),
                vec![hex::encode(Sha256::digest(b"abcd"))],
                false,
            )
            .await
            .unwrap();
        assert_eq!((offset, sequence), (4, 1));
        assert!(next.execution_generation > task.execution_generation);
        f.service
            .transfers
            .upload_chunk(&token, b"efgh", Some(1), f.service.events.as_ref())
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"original");
        f.service
            .transfers
            .finish_upload(&token, f.service.events.as_ref())
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(target).await.unwrap(), b"abcdefgh");
        assert_eq!(f.service.transfers.semaphore.available_permits(), 5);
    }
    #[tokio::test]
    async fn rename_completed_before_confirmation_is_reconciled_without_rewriting_target() {
        let f = fixture().await;
        let (token, task) = f
            .service
            .transfers
            .begin_upload(
                &f.service,
                &f.session,
                "new.bin".into(),
                f.dir.path().display().to_string(),
                "ask",
                4,
                Some(12),
            )
            .await
            .unwrap()
            .unwrap();
        f.service
            .transfers
            .upload_chunk(&token, b"done", Some(0), f.service.events.as_ref())
            .await
            .unwrap();
        f.service
            .transfers
            .pause(&task.id, f.service.events.as_ref())
            .await
            .unwrap();
        let entry = f.service.transfers.entry(&task.id).await.unwrap();
        let mut record = entry.lock().await;
        record.files[0].committing = true;
        f.service.transfers.repository.save(&record).unwrap();
        FileBackend::Local
            .commit_staged(&record.files[0].stage, &record.files[0].target, false)
            .await
            .unwrap();
        drop(record);
        let (token, task, offset, _) = f
            .service
            .transfers
            .resume_upload(
                &f.service,
                &task.id,
                4,
                Some(12),
                vec![hex::encode(Sha256::digest(b"done"))],
                false,
            )
            .await
            .unwrap();
        assert!(token.is_empty());
        assert_eq!(task.status, "completed");
        assert_eq!(offset, 4);
        assert_eq!(
            tokio::fs::read(f.dir.path().join("new.bin")).await.unwrap(),
            b"done"
        );
    }
    #[tokio::test]
    async fn directory_files_empty_files_and_archives_use_the_same_engine() {
        for mode in ["preserve", "archive"] {
            let f = fixture().await;
            let source = f.dir.path().join("folder");
            let target = f.dir.path().join("target");
            tokio::fs::create_dir_all(source.join("empty-dir"))
                .await
                .unwrap();
            tokio::fs::write(source.join("empty-file"), [])
                .await
                .unwrap();
            tokio::fs::write(source.join("内容.txt"), b"text")
                .await
                .unwrap();
            let id = copy(&f, source.to_str().unwrap(), target.to_str().unwrap(), mode).await;
            let record = finished(&f, &id).await;
            assert_eq!(
                record.task.status, "completed",
                "{}",
                record.task.error_message
            );
            if mode == "preserve" {
                assert!(target.join("folder/empty-dir").is_dir());
                assert_eq!(
                    tokio::fs::read(target.join("folder/内容.txt"))
                        .await
                        .unwrap(),
                    b"text"
                );
                assert_eq!(
                    std::fs::metadata(target.join("folder/empty-file"))
                        .unwrap()
                        .len(),
                    0
                );
            } else {
                assert!(target.join("folder.tar.gz").is_file());
            }
            let response = super::super::transfer::sftp_download(
                &f.service,
                f.session.clone(),
                vec![source.display().to_string()],
            )
            .await
            .unwrap();
            let task = response.tasks[0].clone();
            assert_eq!(finished(&f, &task.id).await.task.status, "completed");
            let (path, _) = f
                .service
                .transfers
                .download_artifact(&task.id)
                .await
                .unwrap();
            let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
            assert_eq!(archive.by_name("folder/内容.txt").unwrap().size(), 4);
        }
    }
    #[tokio::test]
    async fn directory_resume_keeps_committed_files_and_continues_each_file_checkpoint() {
        let mut f = fixture().await;
        let source = f.dir.path().join("directory");
        let destination = f.dir.path().join("target");
        tokio::fs::create_dir(&source).await.unwrap();
        tokio::fs::write(source.join("0-small"), b"done")
            .await
            .unwrap();
        let bytes = vec![77; BLOCK_SIZE * 8];
        tokio::fs::write(source.join("1-large"), &bytes)
            .await
            .unwrap();
        let id = copy(
            &f,
            source.to_str().unwrap(),
            destination.to_str().unwrap(),
            "preserve",
        )
        .await;
        first_block(&mut f, &id).await;
        f.service
            .transfers
            .pause(&id, f.service.events.as_ref())
            .await
            .unwrap();
        let record = f
            .service
            .transfers
            .entry(&id)
            .await
            .unwrap()
            .lock()
            .await
            .clone();
        assert!(record.files[0].committed);
        assert!(!record.files[1].committed);
        assert!(record.files[1].confirmed_offset > 0);
        let first = destination.join("directory/0-small");
        let modified = std::fs::metadata(&first).unwrap().modified().unwrap();
        f.service.transfers =
            ResumableTransfers::new(TransferRepository::new(f.db.clone(), f.key.clone()).unwrap())
                .unwrap();
        f.service
            .transfers
            .resume(&f.service, &id, false)
            .await
            .unwrap();
        assert_eq!(finished(&f, &id).await.task.status, "completed");
        assert_eq!(
            std::fs::metadata(first).unwrap().modified().unwrap(),
            modified
        );
        assert_eq!(
            tokio::fs::read(destination.join("directory/1-large"))
                .await
                .unwrap(),
            bytes
        );
    }

    #[tokio::test]
    async fn waiting_upload_can_be_paused_without_blocking_other_permits() {
        let mut f = fixture().await;
        for index in 0..5 {
            f.service
                .transfers
                .begin_upload(
                    &f.service,
                    &f.session,
                    format!("queued-{index}"),
                    f.dir.path().display().to_string(),
                    "ask",
                    4,
                    Some(1),
                )
                .await
                .unwrap();
        }
        assert_eq!(f.service.transfers.semaphore.available_permits(), 0);
        let service = f.service.clone();
        let session = f.session.clone();
        let directory = f.dir.path().display().to_string();
        let waiting = tokio::spawn(async move {
            service
                .transfers
                .begin_upload(
                    &service,
                    &session,
                    "queued-six".into(),
                    directory,
                    "ask",
                    4,
                    Some(1),
                )
                .await
        });
        let id = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let event = f.events.recv().await.unwrap();
                if event["file_name"] == "queued-six" {
                    break event["task_id"].as_str().unwrap().to_owned();
                }
            }
        })
        .await
        .unwrap();
        tokio::time::timeout(
            Duration::from_secs(5),
            f.service.transfers.pause(&id, f.service.events.as_ref()),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(waiting.await.unwrap().unwrap_err().code, "TRANSFER_STOPPED");
        f.service
            .transfers
            .shutdown(f.service.events.as_ref())
            .await;
        assert_eq!(f.service.transfers.semaphore.available_permits(), 5);
    }

    #[tokio::test]
    async fn injected_disk_and_network_failures_keep_targets_and_allow_retry() {
        for code in ["DISK_FULL", "TRANSFER_IO"] {
            let f = fixture().await;
            let source = f.dir.path().join("small.bin");
            let target = f.dir.path().join("target");
            tokio::fs::create_dir(&target).await.unwrap();
            tokio::fs::write(&source, b"new data").await.unwrap();
            tokio::fs::write(target.join("small.bin"), b"original")
                .await
                .unwrap();
            *f.service.transfers.write_fault.lock().await =
                Some(CommandError::new(code, "模拟故障").retryable());
            let id = copy(
                &f,
                source.to_str().unwrap(),
                target.to_str().unwrap(),
                "preserve",
            )
            .await;
            let record = finished(&f, &id).await;
            assert_eq!(record.task.error_code, code);
            assert!(record.task.retryable);
            assert_eq!(record.task.confirmed_offset, 0);
            assert_eq!(f.service.transfers.semaphore.available_permits(), 5);
            assert_eq!(
                tokio::fs::read(target.join("small.bin")).await.unwrap(),
                b"original"
            );
            f.service
                .transfers
                .resume(&f.service, &id, false)
                .await
                .unwrap();
            assert_eq!(finished(&f, &id).await.task.status, "completed");
            assert_eq!(
                tokio::fs::read(target.join("small.bin")).await.unwrap(),
                b"new data"
            );
        }
    }
}
