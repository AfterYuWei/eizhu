use std::{sync::Arc, time::SystemTime};

use chrono::{DateTime, Utc};
use russh_sftp::{
    client::{RawSftpSession, SftpSession},
    protocol::{FileAttributes, OpenFlags, Packet, StatusCode},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::{infrastructure::platform::local_files, ssh::transport::ConnectedRoute};

use super::SftpError;

pub(crate) enum FileBackend {
    Local,
    Remote {
        sftp: Arc<SftpSession>,
        atomic: Option<Arc<RawSftpSession>>,
        _route: ConnectedRoute,
    },
}

pub(crate) type BackendReader = Box<dyn tokio::io::AsyncRead + Unpin + Send>;
pub(crate) type BackendWriter = Box<dyn tokio::io::AsyncWrite + Unpin + Send>;

#[derive(Debug, Clone)]
pub(crate) struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: SystemTime,
    pub mode: String,
}

impl FileBackend {
    pub async fn close(&self) {
        if let Self::Remote { sftp, atomic, .. } = self {
            let _ = sftp.close().await;
            if let Some(raw) = atomic {
                let _ = raw.close_session();
            }
        }
    }

    pub async fn probe_atomic(route: &ConnectedRoute) -> Option<Arc<RawSftpSession>> {
        let stream = route.open_subsystem("sftp").await.ok()?;
        let raw = RawSftpSession::new(stream);
        raw.set_timeout(5);
        let version = raw.init().await.ok()?;
        if version
            .extensions
            .get("posix-rename@openssh.com")
            .is_some_and(|v| v == "1")
        {
            Some(Arc::new(raw))
        } else {
            let _ = raw.close_session();
            None
        }
    }
    pub fn supports_atomic_replace(&self) -> bool {
        matches!(
            self,
            Self::Local
                | Self::Remote {
                    atomic: Some(_),
                    ..
                }
        )
    }
    /// Unlike stat().ok(), this preserves permission and network errors.
    pub async fn entry_kind(&self, path: &str) -> Result<Option<bool>, SftpError> {
        match self {
            Self::Local => {
                match tokio::fs::symlink_metadata(local_files::path_from_api(path)).await {
                    Ok(meta) => Ok(Some(meta.file_type().is_symlink())),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                    Err(e) => Err(file_error(e)),
                }
            }
            Self::Remote { sftp, .. } => match sftp.symlink_metadata(path).await {
                Ok(meta) => Ok(Some(meta.is_symlink())),
                Err(russh_sftp::client::error::Error::Status(status))
                    if status.status_code == StatusCode::NoSuchFile =>
                {
                    Ok(None)
                }
                Err(e) => Err(sftp_error(e)),
            },
        }
    }
    pub async fn copy_permissions(&self, source: &str, temp: &str) -> Result<(), SftpError> {
        match self {
            Self::Local => {
                let meta = tokio::fs::metadata(local_files::path_from_api(source))
                    .await
                    .map_err(file_error)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    let temp_path = local_files::path_from_api(temp);
                    let temp_meta = tokio::fs::metadata(&temp_path).await.map_err(file_error)?;
                    if meta.uid() != temp_meta.uid() || meta.gid() != temp_meta.gid() {
                        let (uid, gid) = (meta.uid(), meta.gid());
                        tokio::task::spawn_blocking(move || {
                            std::os::unix::fs::chown(temp_path, Some(uid), Some(gid))
                        })
                        .await
                        .map_err(|e| SftpError::from(e.to_string()))?
                        .map_err(file_error)?;
                    }
                }
                tokio::fs::set_permissions(local_files::path_from_api(temp), meta.permissions())
                    .await
                    .map_err(file_error)
            }
            Self::Remote { sftp, .. } => {
                let meta = sftp.metadata(source).await.map_err(sftp_error)?;
                sftp.set_metadata(
                    temp,
                    FileAttributes {
                        permissions: meta.permissions,
                        uid: meta.uid,
                        gid: meta.gid,
                        ..Default::default()
                    },
                )
                .await
                .map_err(sftp_error)
            }
        }
    }
    pub async fn commit_staged(
        &self,
        temp: &str,
        target: &str,
        replace: bool,
    ) -> Result<(), SftpError> {
        match self {
            Self::Local if !replace => {
                tokio::fs::hard_link(
                    local_files::path_from_api(temp),
                    local_files::path_from_api(target),
                )
                .await
                .map_err(file_error)?;
                let _ = tokio::fs::remove_file(local_files::path_from_api(temp)).await;
                Ok(())
            }
            Self::Local => self.rename(temp, target).await,
            Self::Remote {
                atomic: Some(raw), ..
            } if replace => posix_rename(raw, temp, target).await,
            Self::Remote { .. } if !replace => self.rename(temp, target).await,
            _ => Err("服务器不支持安全替换，请另存为新文件".into()),
        }
    }

    pub async fn exec(&self, command: &str) -> Result<(String, i32), SftpError> {
        let Self::Remote { _route: route, .. } = self else {
            return Err("command execution is unavailable for local sessions".into());
        };
        Ok(route
            .exec(command)
            .await
            .map_err(|error| error.to_string())?)
    }

    pub async fn list(&self, path: &str) -> Result<Vec<FileInfo>, SftpError> {
        match self {
            Self::Local => {
                let mut directory = tokio::fs::read_dir(local_files::path_from_api(path))
                    .await
                    .map_err(file_error)?;
                let mut result = Vec::new();
                while let Some(entry) = directory.next_entry().await.map_err(file_error)? {
                    let metadata = entry.metadata().await.map_err(file_error)?;
                    let name = entry.file_name().to_string_lossy().into_owned();
                    result.push(FileInfo {
                        path: join_path(path, &name),
                        name,
                        is_dir: metadata.is_dir(),
                        size: metadata.len(),
                        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                        mode: local_files::mode(&metadata),
                    });
                }
                Ok(result)
            }
            Self::Remote { sftp, .. } => {
                sftp.read_dir(path)
                    .await
                    .map_err(sftp_error)
                    .map(|entries| {
                        entries
                            .map(|entry| {
                                let metadata = entry.metadata();
                                FileInfo {
                                    name: entry.file_name(),
                                    path: entry.path(),
                                    is_dir: metadata.file_type().is_dir(),
                                    size: metadata.len(),
                                    modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                                    mode: metadata.permissions().to_string(),
                                }
                            })
                            .collect()
                    })
            }
        }
    }

    pub async fn stat(&self, path: &str) -> Result<FileInfo, SftpError> {
        match self {
            Self::Local => {
                let metadata = tokio::fs::metadata(local_files::path_from_api(path))
                    .await
                    .map_err(file_error)?;
                Ok(FileInfo {
                    name: base_name(path),
                    path: clean_path(path),
                    is_dir: metadata.is_dir(),
                    size: metadata.len(),
                    modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    mode: local_files::mode(&metadata),
                })
            }
            Self::Remote { sftp, .. } => {
                let metadata = sftp.metadata(path).await.map_err(sftp_error)?;
                Ok(FileInfo {
                    name: base_name(path),
                    path: clean_path(path),
                    is_dir: metadata.file_type().is_dir(),
                    size: metadata.len(),
                    modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    mode: metadata.permissions().to_string(),
                })
            }
        }
    }

    pub async fn mkdir(&self, path: &str) -> Result<(), SftpError> {
        match self {
            Self::Local => tokio::fs::create_dir(local_files::path_from_api(path))
                .await
                .map_err(file_error),
            Self::Remote { sftp, .. } => sftp.create_dir(path).await.map_err(sftp_error),
        }
    }

    pub async fn mkdir_all(&self, path: &str) -> Result<(), SftpError> {
        if matches!(self, Self::Local) {
            return tokio::fs::create_dir_all(local_files::path_from_api(path))
                .await
                .map_err(file_error);
        }
        let mut current = String::new();
        for component in clean_path(path)
            .split('/')
            .filter(|value| !value.is_empty())
        {
            current.push('/');
            current.push_str(component);
            if self.stat(&current).await.is_err() {
                self.mkdir(&current).await?;
            }
        }
        Ok(())
    }

    pub async fn rename(&self, old_path: &str, new_path: &str) -> Result<(), SftpError> {
        match self {
            Self::Local => tokio::fs::rename(
                local_files::path_from_api(old_path),
                local_files::path_from_api(new_path),
            )
            .await
            .map_err(file_error),
            Self::Remote { sftp, .. } => sftp.rename(old_path, new_path).await.map_err(sftp_error),
        }
    }

    pub async fn remove_file(&self, path: &str) -> Result<(), SftpError> {
        match self {
            Self::Local => tokio::fs::remove_file(local_files::path_from_api(path))
                .await
                .map_err(file_error),
            Self::Remote { sftp, .. } => sftp.remove_file(path).await.map_err(sftp_error),
        }
    }

    pub async fn remove_dir(&self, path: &str) -> Result<(), SftpError> {
        match self {
            Self::Local => tokio::fs::remove_dir(local_files::path_from_api(path))
                .await
                .map_err(file_error),
            Self::Remote { sftp, .. } => sftp.remove_dir(path).await.map_err(sftp_error),
        }
    }

    pub async fn read(&self, path: &str, limit: Option<usize>) -> Result<Vec<u8>, SftpError> {
        let mut output = Vec::new();
        match self {
            Self::Local => {
                let file = tokio::fs::File::open(local_files::path_from_api(path))
                    .await
                    .map_err(file_error)?;
                match limit {
                    Some(limit) => file.take((limit + 1) as u64).read_to_end(&mut output).await,
                    None => file.take(u64::MAX).read_to_end(&mut output).await,
                }
                .map_err(file_error)?;
            }
            Self::Remote { sftp, .. } => {
                let file = sftp.open(path).await.map_err(sftp_error)?;
                match limit {
                    Some(limit) => file.take((limit + 1) as u64).read_to_end(&mut output).await,
                    None => file.take(u64::MAX).read_to_end(&mut output).await,
                }
                .map_err(file_error)?;
            }
        }
        Ok(output)
    }

    pub async fn open_read(&self, path: &str) -> Result<BackendReader, SftpError> {
        self.open_read_at(path, 0).await
    }
    pub async fn open_read_at(&self, path: &str, offset: u64) -> Result<BackendReader, SftpError> {
        match self {
            Self::Local => {
                let mut file = tokio::fs::File::open(local_files::path_from_api(path))
                    .await
                    .map_err(file_error)?;
                file.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(file_error)?;
                Ok(Box::new(file))
            }
            Self::Remote { sftp, .. } => {
                let mut file = sftp.open(path).await.map_err(sftp_error)?;
                file.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(file_error)?;
                Ok(Box::new(file))
            }
        }
    }

    /// Acknowledged, seekable writes never truncate the original destination.
    pub async fn write_chunk_at(
        &self,
        path: &str,
        offset: u64,
        data: &[u8],
    ) -> Result<(), SftpError> {
        match self {
            Self::Local => {
                let mut file = tokio::fs::OpenOptions::new()
                    .write(true)
                    .open(local_files::path_from_api(path))
                    .await
                    .map_err(file_error)?;
                file.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(file_error)?;
                file.write_all(data).await.map_err(file_error)?;
                file.sync_data().await.map_err(file_error)
            }
            Self::Remote { sftp, .. } => {
                let mut file = sftp
                    .open_with_flags(path, OpenFlags::WRITE)
                    .await
                    .map_err(sftp_error)?;
                file.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(file_error)?;
                file.write_all(data).await.map_err(file_error)?;
                file.flush().await.map_err(file_error)?;
                file.sync_all().await.map_err(sftp_error)?;
                file.close().await.map_err(file_error)
            }
        }
    }
    /// Read a bounded range and await remote CLOSE, including when READ fails.
    pub async fn read_chunk_at(
        &self,
        path: &str,
        offset: u64,
        length: usize,
    ) -> Result<Vec<u8>, SftpError> {
        let mut bytes = vec![0; length];
        match self {
            Self::Local => {
                let mut file = tokio::fs::File::open(local_files::path_from_api(path))
                    .await
                    .map_err(file_error)?;
                file.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(file_error)?;
                file.read_exact(&mut bytes)
                    .await
                    .map_err(|e| SftpError::transfer(e.to_string()))?;
                Ok(bytes)
            }
            Self::Remote { sftp, .. } => {
                let mut file = sftp.open(path).await.map_err(sftp_error)?;
                let result = async {
                    file.seek(std::io::SeekFrom::Start(offset))
                        .await
                        .map_err(file_error)?;
                    file.read_exact(&mut bytes).await.map_err(file_error)?;
                    Ok::<_, SftpError>(bytes)
                }
                .await;
                let closed = file.close().await.map_err(file_error);
                match result {
                    Ok(bytes) => {
                        closed?;
                        Ok(bytes)
                    }
                    Err(error) => Err(error),
                }
            }
        }
    }
    pub async fn truncate(&self, path: &str, size: u64) -> Result<(), SftpError> {
        match self {
            Self::Local => tokio::fs::OpenOptions::new()
                .write(true)
                .open(local_files::path_from_api(path))
                .await
                .map_err(file_error)?
                .set_len(size)
                .await
                .map_err(file_error),
            Self::Remote { sftp, .. } => sftp
                .set_metadata(
                    path,
                    FileAttributes {
                        size: Some(size),
                        ..Default::default()
                    },
                )
                .await
                .map_err(sftp_error),
        }
    }

    pub async fn open_write(&self, path: &str) -> Result<BackendWriter, SftpError> {
        match self {
            Self::Local => tokio::fs::File::create(local_files::path_from_api(path))
                .await
                .map(|file| Box::new(file) as BackendWriter)
                .map_err(file_error),
            Self::Remote { sftp, .. } => sftp
                .create(path)
                .await
                .map(|file| Box::new(file) as BackendWriter)
                .map_err(sftp_error),
        }
    }

    pub async fn write_private_new(&self, path: &str, data: &[u8]) -> Result<(), SftpError> {
        match self {
            Self::Local => {
                let mut options = tokio::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                let mut file = options
                    .open(local_files::path_from_api(path))
                    .await
                    .map_err(file_error)?;
                file.write_all(data).await.map_err(file_error)?;
                file.sync_all().await.map_err(file_error)
            }
            Self::Remote { sftp, .. } => {
                let mut file = sftp
                    .open_with_flags_and_attributes(
                        path,
                        OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
                        FileAttributes {
                            permissions: Some(0o600),
                            ..Default::default()
                        },
                    )
                    .await
                    .map_err(sftp_error)?;
                file.write_all(data).await.map_err(file_error)?;
                file.flush().await.map_err(file_error)?;
                file.sync_all().await.map_err(sftp_error)?;
                file.close().await.map_err(file_error)
            }
        }
    }
}

pub(crate) fn clean_path(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut components = Vec::new();
    for component in path.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                components.pop();
            }
            value => components.push(value),
        }
    }
    let cleaned = components.join("/");
    if absolute {
        if cleaned.is_empty() {
            "/".into()
        } else {
            format!("/{cleaned}")
        }
    } else if cleaned.is_empty() {
        ".".into()
    } else {
        cleaned
    }
}

pub(crate) fn join_path(parent: &str, child: &str) -> String {
    clean_path(&format!("{}/{}", parent.trim_end_matches('/'), child))
}

pub(crate) fn base_name(path: &str) -> String {
    clean_path(path)
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_owned()
}

pub(crate) fn format_time(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339()
}

pub(crate) fn local_home_dir() -> String {
    local_files::home_dir()
}

pub(crate) fn local_path_to_api(path: &std::path::Path) -> String {
    local_files::path_to_api(path)
}

fn file_error(error: std::io::Error) -> SftpError {
    SftpError::Backend(error.to_string())
}

fn sftp_error(error: russh_sftp::client::error::Error) -> SftpError {
    SftpError::Backend(error.to_string())
}

async fn posix_rename(raw: &RawSftpSession, temp: &str, target: &str) -> Result<(), SftpError> {
    let mut data = Vec::new();
    for path in [temp, target] {
        data.extend_from_slice(&(path.len() as u32).to_be_bytes());
        data.extend_from_slice(path.as_bytes());
    }
    match raw
        .extended("posix-rename@openssh.com", data)
        .await
        .map_err(sftp_error)?
    {
        Packet::Status(status) if status.status_code == StatusCode::Ok => Ok(()),
        _ => Err("服务器未确认安全替换".into()),
    }
}
#[cfg(test)]
mod atomic_tests {
    use super::*;
    struct Server {
        reject: bool,
    }
    impl russh_sftp::server::Handler for Server {
        type Error = StatusCode;
        fn unimplemented(&self) -> Self::Error {
            StatusCode::OpUnsupported
        }
        async fn extended(
            &mut self,
            id: u32,
            request: String,
            mut data: Vec<u8>,
        ) -> Result<Packet, Self::Error> {
            assert_eq!(request, "posix-rename@openssh.com");
            for expected in ["/配置/.临时", "/配置/正式文件"] {
                let len = u32::from_be_bytes(data[..4].try_into().unwrap()) as usize;
                assert_eq!(std::str::from_utf8(&data[4..4 + len]).unwrap(), expected);
                data.drain(..4 + len);
            }
            assert!(data.is_empty());
            if self.reject {
                return Err(StatusCode::PermissionDenied);
            }
            Ok(Packet::Status(russh_sftp::protocol::Status {
                id,
                status_code: StatusCode::Ok,
                error_message: String::new(),
                language_tag: String::new(),
            }))
        }
    }
    #[tokio::test]
    async fn posix_rename_uses_structured_utf8_paths_and_requires_acknowledgement() {
        for reject in [false, true] {
            let (client, server) = tokio::io::duplex(4096);
            let task = tokio::spawn(russh_sftp::server::run(server, Server { reject }));
            let raw = RawSftpSession::new(client);
            raw.init().await.unwrap();
            assert_eq!(
                posix_rename(&raw, "/配置/.临时", "/配置/正式文件")
                    .await
                    .is_err(),
                reject
            );
            raw.close_session().unwrap();
            task.await.unwrap();
        }
    }
}
