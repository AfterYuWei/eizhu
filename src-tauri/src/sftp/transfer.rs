use super::{
    backend::{base_name, clean_path, join_path, FileBackend},
    error::SftpError,
    state::SftpService,
    task_repository::TransferDescriptor,
};
use crate::error::CommandError;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
const MAX_IPC_CHUNK_SIZE: usize = 1024 * 1024;
fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TransferTask {
    pub(super) id: String,
    pub(super) file_name: String,
    pub(super) direction: String,
    pub(super) size: u64,
    pub(super) transferred: u64,
    pub(super) status: String,
    pub(super) speed: u64,
    pub(super) started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) finished_at: Option<i64>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) error_message: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(super) error_code: String,
    pub(super) retryable: bool,
    #[serde(default)]
    pub(super) execution_generation: u64,
    #[serde(default)]
    pub(super) confirmed_offset: u64,
    #[serde(default)]
    pub(super) source_profile: String,
    #[serde(default)]
    pub(super) target_profile: String,
}

impl TransferTask {
    pub(super) fn new(id: String, file_name: String, direction: &str, size: u64) -> Self {
        Self {
            id,
            file_name,
            direction: direction.into(),
            size,
            transferred: 0,
            status: "queued".into(),
            speed: 0,
            started_at: now_millis(),
            finished_at: None,
            error_message: String::new(),
            error_code: String::new(),
            retryable: false,
            execution_generation: 0,
            confirmed_offset: 0,
            source_profile: String::new(),
            target_profile: String::new(),
        }
    }
}
pub(super) struct SpeedMeter {
    sampled_at: Instant,
    sampled_bytes: u64,
    speed: u64,
}

impl SpeedMeter {
    pub(super) fn new(now: Instant) -> Self {
        Self {
            sampled_at: now,
            sampled_bytes: 0,
            speed: 0,
        }
    }

    pub(super) fn record(&mut self, total_bytes: u64, now: Instant) -> u64 {
        let elapsed = now.saturating_duration_since(self.sampled_at);
        if elapsed >= Duration::from_millis(250) {
            self.speed = (total_bytes.saturating_sub(self.sampled_bytes) as f64
                / elapsed.as_secs_f64()) as u64;
            self.sampled_at = now;
            self.sampled_bytes = total_bytes;
        }
        self.speed
    }
}
#[derive(Debug, Serialize)]
pub(crate) struct SftpUploadResponse {
    pub(crate) tasks: Vec<TransferTask>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SftpUploadBeginResponse {
    pub(crate) upload_id: String,
    tasks: Vec<TransferTask>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SftpUploadChunkResponse {
    received: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct SftpDownloadResponse {
    pub(super) tasks: Vec<TransferTask>,
    download_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SftpConflictInfo {
    source_path: String,
    dest_path: String,
    source_size: u64,
    dest_size: u64,
    source_is_dir: bool,
    dest_is_dir: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct SftpTransferResponse {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(super) task_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    method: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tasks: Vec<TransferTask>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    conflicts: Vec<SftpConflictInfo>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SftpMoveFailure {
    path: String,
    message: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SftpMoveResponse {
    moved: Vec<String>,
    skipped: Vec<String>,
    failures: Vec<SftpMoveFailure>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    conflicts: Vec<SftpConflictInfo>,
}
fn validate_upload_name(name: &str) -> Result<(), CommandError> {
    if name.is_empty() || matches!(name, "." | "..") || name.contains(['/', '\\']) {
        return Err(CommandError::new(
            "VALIDATION",
            "upload name must be a file name without path separators",
        ));
    }
    Ok(())
}

fn validate_conflict_resolution(resolution: &str) -> Result<(), CommandError> {
    if matches!(resolution, "ask" | "overwrite" | "rename" | "skip") {
        Ok(())
    } else {
        Err(CommandError::new(
            "VALIDATION",
            "invalid conflict_resolution",
        ))
    }
}

pub(crate) async fn sftp_upload_begin(
    state: &SftpService,
    session_id: String,
    name: String,
    dest_dir: String,
    overwrite: bool,
    size: u64,
    last_modified: Option<u64>,
) -> Result<SftpUploadBeginResponse, CommandError> {
    validate_upload_name(&name)?;
    state
        .transfers
        .begin_upload(
            state,
            &session_id,
            name,
            dest_dir,
            if overwrite { "overwrite" } else { "ask" },
            size,
            last_modified,
        )
        .await?
        .map(|(upload_id, task)| SftpUploadBeginResponse {
            upload_id,
            tasks: vec![task],
        })
        .ok_or_else(|| CommandError::new("INTERNAL", "上传意外跳过"))
}
pub(crate) async fn sftp_upload_begin_with_resolution(
    state: &SftpService,
    session_id: String,
    name: String,
    dest_dir: String,
    resolution: &str,
    size: u64,
) -> Result<Option<SftpUploadBeginResponse>, CommandError> {
    validate_upload_name(&name)?;
    validate_conflict_resolution(resolution)?;
    Ok(state
        .transfers
        .begin_upload(state, &session_id, name, dest_dir, resolution, size, None)
        .await?
        .map(|(upload_id, task)| SftpUploadBeginResponse {
            upload_id,
            tasks: vec![task],
        }))
}
pub(crate) async fn upload_chunk(
    state: &SftpService,
    upload_id: &str,
    bytes: &[u8],
) -> Result<SftpUploadChunkResponse, CommandError> {
    upload_chunk_sequenced(state, upload_id, bytes, None).await
}
pub(crate) async fn upload_chunk_sequenced(
    state: &SftpService,
    upload_id: &str,
    bytes: &[u8],
    sequence: Option<u64>,
) -> Result<SftpUploadChunkResponse, CommandError> {
    Ok(SftpUploadChunkResponse {
        received: state
            .transfers
            .upload_chunk(upload_id, bytes, sequence, state.events.as_ref())
            .await?,
    })
}
pub(crate) async fn sftp_upload_chunk_base64(
    state: &SftpService,
    upload_id: String,
    data: String,
    sequence: Option<u64>,
) -> Result<SftpUploadChunkResponse, CommandError> {
    if data.len() > MAX_IPC_CHUNK_SIZE.div_ceil(3) * 4 {
        return Err(CommandError::new("VALIDATION", "上传块过大"));
    }
    let bytes = STANDARD
        .decode(data)
        .map_err(|_| CommandError::new("VALIDATION", "上传块编码无效"))?;
    upload_chunk_sequenced(state, &upload_id, &bytes, sequence).await
}
pub(crate) async fn sftp_upload_finish(
    state: &SftpService,
    upload_id: String,
) -> Result<SftpUploadResponse, CommandError> {
    Ok(SftpUploadResponse {
        tasks: vec![
            state
                .transfers
                .finish_upload(&upload_id, state.events.as_ref())
                .await?,
        ],
    })
}
pub(crate) async fn sftp_upload_abort(
    state: &SftpService,
    upload_id: String,
) -> Result<(), CommandError> {
    state.transfers.abort_upload(&upload_id, state).await
}
pub(crate) async fn sftp_list_transfers(
    state: &SftpService,
    session_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<TransferTask>, CommandError> {
    Ok(state
        .transfers
        .list(session_id.as_deref(), status.as_deref())
        .await)
}
pub(crate) async fn sftp_cancel_transfer(
    state: &SftpService,
    task_id: String,
) -> Result<serde_json::Value, CommandError> {
    serde_json::to_value(state.transfers.cancel(state, &task_id).await?)
        .map_err(CommandError::database)
}
pub(crate) async fn sftp_clear_completed_transfers(
    state: &SftpService,
) -> Result<(), CommandError> {
    state.transfers.clear_completed(state).await
}
pub(crate) async fn sftp_pause_transfer(
    state: &SftpService,
    task_id: String,
) -> Result<TransferTask, CommandError> {
    state.transfers.pause(&task_id, state.events.as_ref()).await
}
pub(crate) async fn sftp_resume_transfer(
    state: &SftpService,
    task_id: String,
) -> Result<TransferTask, CommandError> {
    state.transfers.resume(state, &task_id, false).await
}
pub(crate) async fn sftp_retry_transfer(
    state: &SftpService,
    task_id: String,
    restart: bool,
) -> Result<TransferTask, CommandError> {
    state.transfers.resume(state, &task_id, restart).await
}
pub(crate) async fn sftp_upload_checkpoint(
    state: &SftpService,
    task_id: String,
) -> Result<serde_json::Value, CommandError> {
    state.transfers.upload_checkpoint(&task_id).await
}
pub(crate) async fn sftp_resume_upload(
    state: &SftpService,
    task_id: String,
    size: u64,
    last_modified: Option<u64>,
    digests: Vec<String>,
    restart: bool,
) -> Result<serde_json::Value, CommandError> {
    let (upload_id, task, received, sequence) = state
        .transfers
        .resume_upload(state, &task_id, size, last_modified, digests, restart)
        .await?;
    Ok(
        serde_json::json!({"upload_id":upload_id,"tasks":[task],"received":received,"sequence":sequence}),
    )
}
pub(crate) async fn sftp_download(
    state: &SftpService,
    session_id: String,
    paths: Vec<String>,
) -> Result<SftpDownloadResponse, CommandError> {
    if paths.is_empty() {
        return Err(CommandError::new("VALIDATION", "请选择下载文件"));
    }
    let (session, backend) = state.backend(&session_id).await?;
    let zipped = paths.len() != 1 || backend.stat(&paths[0]).await.map_err(internal)?.is_dir;
    let name = if zipped {
        "download.zip".into()
    } else {
        base_name(&paths[0])
    };
    let task = state
        .transfers
        .create(
            TransferDescriptor::Download {
                source_profile: session.profile_id.clone(),
                paths,
                artifact: String::new(),
            },
            name,
            "download",
            0,
            state.events.as_ref(),
        )
        .await?;
    let task = state.transfers.resume(state, &task.id, false).await?;
    Ok(SftpDownloadResponse {
        download_url: format!("tauri://download/{}", task.id),
        tasks: vec![task],
    })
}
pub(crate) async fn sftp_download_chunk(
    state: &SftpService,
    task_id: String,
    offset: u64,
    max_bytes: u32,
) -> Result<Vec<u8>, CommandError> {
    if max_bytes == 0 || max_bytes as usize > MAX_IPC_CHUNK_SIZE {
        return Err(CommandError::new(
            "VALIDATION",
            "下载块必须在 1 B 至 1 MiB 之间",
        ));
    }
    let (path, _) = state.transfers.download_artifact(&task_id).await?;
    read_file_chunk(&path, offset, max_bytes as usize)
        .await
        .map_err(internal)
}
pub(crate) async fn sftp_download_chunk_base64(
    state: &SftpService,
    task_id: String,
    offset: u64,
    max_bytes: u32,
) -> Result<String, CommandError> {
    Ok(STANDARD.encode(sftp_download_chunk(state, task_id, offset, max_bytes).await?))
}
pub(crate) async fn sftp_download_close(
    state: &SftpService,
    task_id: String,
) -> Result<(), CommandError> {
    state.transfers.close_download(&task_id).await
}
pub(crate) async fn sftp_download_artifact(
    state: &SftpService,
    task_id: &str,
) -> Result<(PathBuf, String), CommandError> {
    state.transfers.download_artifact(task_id).await
}
fn internal(error: SftpError) -> CommandError {
    CommandError::new("INTERNAL", error.to_string())
}

pub(super) fn archive_name(path: &str) -> String {
    let name = base_name(path);
    format!(
        "{}.tar.gz",
        if name.is_empty() || name == "/" {
            "archive"
        } else {
            &name
        }
    )
}

struct CancelReader {
    file: std::fs::File,
    cancel: CancellationToken,
}

impl Read for CancelReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "transfer cancelled",
            ));
        }
        self.file.read(buffer)
    }
}

fn append_tar_directory(
    archive: &mut tar::Builder<flate2::write::GzEncoder<std::fs::File>>,
    source_root: &Path,
    directory: &Path,
    archive_root: &str,
    cancel: &CancellationToken,
) -> Result<(), SftpError> {
    if cancel.is_cancelled() {
        return Err("transfer cancelled".into());
    }
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let relative = path
            .strip_prefix(source_root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let archive_path = format!("{archive_root}/{relative}");
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_dir() {
            archive
                .append_dir(format!("{archive_path}/"), &path)
                .map_err(|error| error.to_string())?;
            append_tar_directory(archive, source_root, &path, archive_root, cancel)?;
            continue;
        }
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Regular);
        header.set_mode(0o644);
        header.set_size(metadata.len());
        header.set_mtime(
            metadata
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH)
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        );
        header.set_cksum();
        archive
            .append_data(
                &mut header,
                archive_path,
                CancelReader {
                    file: std::fs::File::open(&path).map_err(|error| error.to_string())?,
                    cancel: cancel.clone(),
                },
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(super) fn make_tar_gz_from_directory(
    source: &Path,
    output: &Path,
    cancel: &CancellationToken,
) -> Result<(), SftpError> {
    if cancel.is_cancelled() {
        return Err("transfer cancelled".into());
    }
    let file = std::fs::File::create(output)
        .map_err(|error| SftpError::archive(format!("create archive: {error}")))?;
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut archive = tar::Builder::new(encoder);
    let root_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("archive");
    archive
        .append_dir(format!("{root_name}/"), source)
        .map_err(|error| error.to_string())?;
    append_tar_directory(&mut archive, source, source, root_name, cancel)?;
    archive
        .into_inner()
        .map_err(|error| error.to_string())?
        .finish()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn append_zip_directory(
    archive: &mut zip::ZipWriter<std::fs::File>,
    root: &Path,
    directory: &Path,
    cancel: &CancellationToken,
) -> Result<(), SftpError> {
    if cancel.is_cancelled() {
        return Err("transfer cancelled".into());
    }
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for entry in std::fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if path.is_dir() {
            archive
                .add_directory(format!("{relative}/"), options)
                .map_err(|error| error.to_string())?;
            append_zip_directory(archive, root, &path, cancel)?;
            continue;
        }
        archive
            .start_file(relative, options)
            .map_err(|error| error.to_string())?;
        let mut input = std::fs::File::open(&path).map_err(|error| error.to_string())?;
        let mut buffer = vec![0_u8; 128 * 1024];
        loop {
            if cancel.is_cancelled() {
                return Err("transfer cancelled".into());
            }
            let read = input.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            archive
                .write_all(&buffer[..read])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(super) fn make_zip_from_directory(
    source: &Path,
    output: &Path,
    cancel: &CancellationToken,
) -> Result<(), SftpError> {
    let file = std::fs::File::create(output).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipWriter::new(file);
    append_zip_directory(&mut archive, source, source, cancel)?;
    archive.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn tree_size<'a>(
    backend: &'a FileBackend,
    path: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<u64, SftpError>> + Send + 'a>> {
    Box::pin(async move {
        if backend.entry_kind(path).await? == Some(true) {
            return Err("目录含符号链接，请单独处理".into());
        }
        let info = backend.stat(path).await?;
        if !info.is_dir {
            return Ok(info.size);
        }
        let mut size = 0_u64;
        for child in backend.list(path).await? {
            size = size.saturating_add(tree_size(backend, &child.path).await?);
        }
        Ok(size)
    })
}
async fn read_file_chunk(path: &Path, offset: u64, max_bytes: usize) -> Result<Vec<u8>, SftpError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| error.to_string())?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0_u8; max_bytes];
    let read = file
        .read(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    bytes.truncate(read);
    Ok(bytes)
}
pub(super) async fn auto_rename(backend: &FileBackend, path: &str) -> Result<String, SftpError> {
    let (stem, extension) = match base_name(path).rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_owned(), format!(".{extension}")),
        _ => (base_name(path), String::new()),
    };
    let parent = parent_path(path);
    for index in 1..10_000 {
        let candidate = join_path(&parent, &format!("{stem} ({index}){extension}"));
        if backend.stat(&candidate).await.is_err() {
            return Ok(candidate);
        }
    }
    Err("cannot find an available destination name".into())
}

pub(super) fn parent_path(path: &str) -> String {
    let path = clean_path(path);
    path.rsplit_once('/')
        .map(|(parent, _)| if parent.is_empty() { "/" } else { parent })
        .unwrap_or(".")
        .to_owned()
}

fn path_within(candidate: &str, root: &str) -> bool {
    let candidate = clean_path(candidate);
    let root = clean_path(root);
    candidate == root || candidate.starts_with(&format!("{}/", root.trim_end_matches('/')))
}

fn normalize_transfer_source_path(source: &FileBackend, path: &str) -> String {
    #[cfg(windows)]
    if matches!(source, FileBackend::Local) {
        return windows_local_path_to_api(path);
    }
    let _ = source;
    clean_path(path)
}

#[cfg(any(windows, test))]
fn windows_local_path_to_api(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.as_bytes().get(1) == Some(&b':') {
        clean_path(&format!("/{normalized}"))
    } else {
        clean_path(&normalized)
    }
}

async fn resolve_destination(
    backend: &FileBackend,
    destination: String,
    resolution: &str,
) -> Result<Option<String>, SftpError> {
    if backend.stat(&destination).await.is_err() {
        return Ok(Some(destination));
    }
    match resolution {
        "overwrite" => Ok(Some(destination)),
        "rename" => Ok(Some(auto_rename(backend, &destination).await?)),
        "skip" | "ask" => Ok(None),
        _ => Err("invalid conflict_resolution".into()),
    }
}

fn remove_all<'a>(
    backend: &'a FileBackend,
    path: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), SftpError>> + Send + 'a>> {
    Box::pin(async move {
        let info = backend.stat(path).await?;
        if !info.is_dir {
            return backend.remove_file(path).await;
        }
        for child in backend.list(path).await? {
            remove_all(backend, &child.path).await?;
        }
        backend.remove_dir(path).await
    })
}
async fn copy_plain(
    source: &FileBackend,
    source_path: &str,
    target: &FileBackend,
    target_path: &str,
) -> Result<(), SftpError> {
    let mut reader = source.open_read(source_path).await?;
    let mut writer = target.open_write(target_path).await?;
    tokio::io::copy(&mut reader, &mut writer)
        .await
        .map_err(|error| error.to_string())?;
    Ok(writer.shutdown().await.map_err(|error| error.to_string())?)
}

fn copy_directory_plain<'a>(
    source: &'a FileBackend,
    source_root: &'a str,
    target: &'a FileBackend,
    target_root: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), SftpError>> + Send + 'a>> {
    Box::pin(async move {
        target.mkdir_all(target_root).await?;
        for child in source.list(source_root).await? {
            let destination = join_path(target_root, &child.name);
            if child.is_dir {
                copy_directory_plain(source, &child.path, target, &destination).await?;
            } else {
                copy_plain(source, &child.path, target, &destination).await?;
            }
        }
        Ok(())
    })
}

impl SftpService {
    pub(crate) async fn materialize_paths(
        &self,
        source_session_id: &str,
        paths: &[String],
        destination_dir: &str,
    ) -> Result<(), CommandError> {
        let (_, source) = self.backend(source_session_id).await?;
        let target = FileBackend::Local;
        let destination_dir = clean_path(destination_dir);
        target.mkdir_all(&destination_dir).await.map_err(internal)?;
        for raw in paths {
            let path = clean_path(raw);
            let info = source.stat(&path).await.map_err(internal)?;
            let destination = join_path(&destination_dir, &info.name);
            if target.stat(&destination).await.is_ok() {
                remove_all(&target, &destination).await.map_err(internal)?;
            }
            if info.is_dir {
                copy_directory_plain(&source, &path, &target, &destination)
                    .await
                    .map_err(internal)?;
            } else {
                copy_plain(&source, &path, &target, &destination)
                    .await
                    .map_err(internal)?;
            }
        }
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn sftp_transfer(
    state: &SftpService,
    source_session_id: String,
    target_session_id: String,
    paths: Vec<String>,
    dest_dir: String,
    conflict_resolution: Option<String>,
    directory_mode: Option<String>,
) -> Result<SftpTransferResponse, CommandError> {
    if paths.is_empty() {
        return Err(CommandError::new("VALIDATION", "请选择传输文件"));
    }
    let (source_session, source) = state.backend(&source_session_id).await?;
    let (target_session, target) = state.backend(&target_session_id).await?;
    let resolution = conflict_resolution.unwrap_or_else(|| "ask".into());
    let directory_mode = directory_mode.unwrap_or_else(|| "archive".into());
    validate_conflict_resolution(&resolution)?;
    if !matches!(directory_mode.as_str(), "preserve" | "archive") {
        return Err(CommandError::new("VALIDATION", "目录模式无效"));
    }
    let paths: Vec<_> = paths
        .into_iter()
        .map(|path| normalize_transfer_source_path(&source, &path))
        .collect();
    let dest_dir = clean_path(&dest_dir);
    let mut conflicts = Vec::new();
    let mut size = 0;
    for path in &paths {
        let info = source.stat(path).await.map_err(internal)?;
        let name = if info.is_dir && directory_mode == "archive" {
            archive_name(path)
        } else {
            info.name.clone()
        };
        let destination = join_path(&dest_dir, &name);
        if source_session.profile_id == target_session.profile_id
            && ((info.is_dir && path_within(&dest_dir, path)) || clean_path(path) == destination)
        {
            return Err(CommandError::new(
                "INVALID_DESTINATION",
                "不能将文件覆盖到自身或将目录复制到内部",
            ));
        }
        if target
            .entry_kind(&destination)
            .await
            .map_err(internal)?
            .is_some()
        {
            let existing = target.stat(&destination).await.map_err(internal)?;
            conflicts.push(SftpConflictInfo {
                source_path: path.clone(),
                dest_path: destination,
                source_size: info.size,
                dest_size: existing.size,
                source_is_dir: info.is_dir,
                dest_is_dir: existing.is_dir,
            });
        }
        size += tree_size(&source, path).await.map_err(internal)?;
    }
    if resolution == "ask" && !conflicts.is_empty() {
        return Ok(SftpTransferResponse {
            task_id: String::new(),
            method: String::new(),
            tasks: vec![],
            conflicts,
        });
    }
    let name = paths
        .iter()
        .map(|path| base_name(path))
        .collect::<Vec<_>>()
        .join(", ");
    let task = state
        .transfers
        .create(
            TransferDescriptor::Copy {
                source_profile: source_session.profile_id.clone(),
                target_profile: target_session.profile_id.clone(),
                paths,
                destination: dest_dir,
                resolution,
                directory_mode,
            },
            name,
            "transfer",
            size,
            state.events.as_ref(),
        )
        .await?;
    let task = state.transfers.resume(state, &task.id, false).await?;
    Ok(SftpTransferResponse {
        task_id: task.id.clone(),
        method: "relay".into(),
        tasks: vec![task],
        conflicts: vec![],
    })
}
pub(crate) async fn sftp_move(
    state: &SftpService,
    session_id: String,
    paths: Vec<String>,
    dest_dir: String,
    conflict_resolution: Option<String>,
) -> Result<SftpMoveResponse, CommandError> {
    let (session, backend) = state.backend(&session_id).await?;
    let resolution = conflict_resolution.unwrap_or_else(|| "ask".into());
    if !matches!(resolution.as_str(), "ask" | "overwrite" | "rename" | "skip") {
        return Err(CommandError::new(
            "VALIDATION",
            "invalid conflict_resolution",
        ));
    }
    let dest_dir = clean_path(&dest_dir);
    if !backend.stat(&dest_dir).await.map_err(internal)?.is_dir {
        return Err(CommandError::new(
            "INVALID_DESTINATION",
            "dest_dir must be an existing directory",
        ));
    }
    let mut prepared = Vec::new();
    let mut conflicts = Vec::new();
    for raw in paths {
        let path = clean_path(&raw);
        let info = backend.stat(&path).await.map_err(internal)?;
        if path == "/"
            || parent_path(&path) == dest_dir
            || (info.is_dir && path_within(&dest_dir, &path))
        {
            return Err(CommandError::new(
                "INVALID_DESTINATION",
                "cannot move root or move an item to its current parent/itself",
            ));
        }
        let destination = join_path(&dest_dir, &info.name);
        if let Ok(existing) = backend.stat(&destination).await {
            conflicts.push(SftpConflictInfo {
                source_path: path.clone(),
                dest_path: destination,
                source_size: info.size,
                dest_size: existing.size,
                source_is_dir: info.is_dir,
                dest_is_dir: existing.is_dir,
            });
        }
        prepared.push((path, info));
    }
    if resolution == "ask" && !conflicts.is_empty() {
        return Ok(SftpMoveResponse {
            moved: Vec::new(),
            skipped: Vec::new(),
            failures: Vec::new(),
            conflicts,
        });
    }
    let mut response = SftpMoveResponse {
        moved: Vec::new(),
        skipped: Vec::new(),
        failures: Vec::new(),
        conflicts: Vec::new(),
    };
    for (path, info) in prepared {
        let destination = join_path(&dest_dir, &info.name);
        match resolve_destination(&backend, destination, &resolution).await {
            Ok(Some(destination)) => match backend
                .commit_staged(
                    &path,
                    &destination,
                    resolution == "overwrite"
                        && backend
                            .entry_kind(&destination)
                            .await
                            .map_err(internal)?
                            .is_some(),
                )
                .await
            {
                Ok(()) => response.moved.push(destination),
                Err(message) => response.failures.push(SftpMoveFailure {
                    path,
                    message: message.to_string(),
                }),
            },
            Ok(None) => response.skipped.push(path),
            Err(message) => response.failures.push(SftpMoveFailure {
                path,
                message: message.to_string(),
            }),
        }
    }
    let _ = state.audit.record(
        &session.profile_id,
        "sftp_move",
        format!(
            "dest={} moved={} skipped={} failed={}",
            dest_dir,
            response.moved.len(),
            response.skipped.len(),
            response.failures.len()
        ),
    );
    Ok(response)
}
#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::*;

    #[test]
    fn windows_local_transfer_uses_only_the_file_name_at_destination() {
        let source = windows_local_path_to_api(r"C:\Projects\anya\miyun\audio_314.mp3");
        assert_eq!(source, "/C:/Projects/anya/miyun/audio_314.mp3");
        assert_eq!(base_name(&source), "audio_314.mp3");
        assert_eq!(
            join_path("/nginx/video", &base_name(&source)),
            "/nginx/video/audio_314.mp3"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn native_windows_drop_path_resolves_to_the_local_file() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("audio_314.mp3");
        tokio::fs::write(&file, b"audio").await.unwrap();
        let backend = FileBackend::Local;
        let source = normalize_transfer_source_path(&backend, &file.to_string_lossy());
        let info = backend.stat(&source).await.unwrap();
        assert_eq!(info.name, "audio_314.mp3");
        assert_eq!(info.size, 5);
    }

    #[test]
    fn transfer_speed_uses_recent_bytes_across_file_boundaries() {
        let start = Instant::now();
        let mut meter = SpeedMeter::new(start);
        assert_eq!(
            meter.record(10_000_000, start + Duration::from_secs(1)),
            10_000_000
        );
        assert_eq!(
            meter.record(10_100_000, start + Duration::from_millis(1100)),
            10_000_000
        );
        assert_eq!(
            meter.record(10_500_000, start + Duration::from_secs(2)),
            500_000
        );
    }

    #[test]
    fn upload_conflict_resolution_rejects_unknown_values() {
        for resolution in ["ask", "overwrite", "rename", "skip"] {
            assert!(validate_conflict_resolution(resolution).is_ok());
        }
        let error = validate_conflict_resolution("replace").unwrap_err();
        assert_eq!(error.code, "VALIDATION");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn upload_destination_supports_rename_skip_and_overwrite() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("report.txt");
        tokio::fs::write(&original, b"old").await.unwrap();
        let backend = FileBackend::Local;
        let original_api = original.to_string_lossy().into_owned();

        assert!(backend.write_private_new(&original_api, &[]).await.is_err());
        assert_eq!(tokio::fs::read(&original).await.unwrap(), b"old");

        let renamed = resolve_destination(&backend, original_api.clone(), "rename")
            .await
            .unwrap()
            .unwrap();
        assert!(renamed.ends_with("report (1).txt"));
        assert!(resolve_destination(&backend, original_api.clone(), "skip")
            .await
            .unwrap()
            .is_none());
        let overwritten = resolve_destination(&backend, original_api.clone(), "overwrite")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(overwritten, original_api);
        assert_eq!(tokio::fs::read(original).await.unwrap(), b"old");
    }

    #[test]
    fn tar_builder_preserves_paths_and_content() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("root");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("a.txt"), b"tar-data").unwrap();
        let output = directory.path().join("archive.tar.gz");
        make_tar_gz_from_directory(&source, &output, &CancellationToken::new()).unwrap();
        let decoder = flate2::read::GzDecoder::new(std::fs::File::open(output).unwrap());
        let mut archive = tar::Archive::new(decoder);
        let mut entries = archive.entries().unwrap();
        let _root = entries.next().unwrap().unwrap();
        let mut entry = entries.next().unwrap().unwrap();
        assert_eq!(
            entry.path().unwrap().as_ref(),
            std::path::Path::new("root/a.txt")
        );
        let mut tar_content = String::new();
        entry.read_to_string(&mut tar_content).unwrap();
        assert_eq!(tar_content, "tar-data");
    }

    #[test]
    fn zip_builder_streams_directory_to_file() {
        let source = tempfile::tempdir().unwrap();
        let nested = source.path().join("dir");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("a.txt"), b"zip-data").unwrap();
        let output_dir = tempfile::tempdir().unwrap();
        let output = output_dir.path().join("download.zip");
        make_zip_from_directory(source.path(), &output, &CancellationToken::new()).unwrap();

        let mut zip = zip::ZipArchive::new(std::fs::File::open(output).unwrap()).unwrap();
        let mut content = String::new();
        zip.by_name("dir/a.txt")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert_eq!(content, "zip-data");
    }

    #[tokio::test]
    async fn download_chunks_are_bounded_and_reconstruct_the_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large.bin");
        let expected = (0..=255).cycle().take(1025).collect::<Vec<u8>>();
        tokio::fs::write(&path, &expected).await.unwrap();

        let mut actual = Vec::new();
        let mut offset = 0;
        loop {
            let chunk = read_file_chunk(&path, offset, 128).await.unwrap();
            if chunk.is_empty() {
                break;
            }
            assert!(chunk.len() <= 128);
            offset += chunk.len() as u64;
            actual.extend(chunk);
        }
        assert_eq!(actual, expected);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tree_size_counts_nested_files_without_loading_them() {
        let directory = tempfile::tempdir().unwrap();
        let nested = directory.path().join("nested");
        tokio::fs::create_dir(&nested).await.unwrap();
        tokio::fs::write(directory.path().join("a"), b"123")
            .await
            .unwrap();
        tokio::fs::write(nested.join("b"), b"45678").await.unwrap();
        let path = directory.path().to_string_lossy();
        assert_eq!(tree_size(&FileBackend::Local, &path).await.unwrap(), 8);
    }

    #[cfg(unix)]
    #[test]
    fn tar_builder_honors_pre_cancelled_transfer() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("large");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("data"), vec![7_u8; 256 * 1024]).unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();
        let error =
            make_tar_gz_from_directory(&path, &directory.path().join("out"), &cancel).unwrap_err();
        assert_eq!(error.to_string(), "transfer cancelled");
    }
}
