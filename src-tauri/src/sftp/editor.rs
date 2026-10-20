//! Isolated staging and optimistic validation for editor saves.
use super::backend::{join_path, FileBackend, FileInfo};
use crate::error::CommandError;
use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};

const LIMIT: usize = 10 * 1024 * 1024;
pub(super) fn content_hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn io_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new("SAVE_FAILED", error.to_string())
}
fn conflict() -> CommandError {
    CommandError::new("FILE_MODIFIED", "远端内容已变化，请比较并合并后重试")
}

async fn validate(
    backend: &FileBackend,
    path: &str,
    time: &str,
    hash: &str,
    create_new: bool,
) -> Result<Option<FileInfo>, CommandError> {
    let kind = backend.entry_kind(path).await.map_err(io_error)?;
    if kind == Some(true) {
        return Err(CommandError::new(
            "ATOMIC_SAVE_UNSUPPORTED",
            "符号链接不支持安全替换，请另存为新文件",
        ));
    }
    let Some(_) = kind else {
        return if !time.is_empty() || !hash.is_empty() {
            Err(conflict())
        } else {
            Ok(None)
        };
    };
    let info = backend.stat(path).await.map_err(io_error)?;
    if info.is_dir {
        return Err(CommandError::new("IS_DIRECTORY", "不能保存到目录"));
    }
    if create_new || time.is_empty() {
        return Err(conflict());
    }
    let expected = DateTime::parse_from_rfc3339(time)
        .map_err(|_| CommandError::new("INVALID_MOD_TIME", "文件修改时间无效"))?;
    let current: DateTime<Utc> = info.modified.into();
    if expected.timestamp_nanos_opt() != current.timestamp_nanos_opt() {
        return Err(conflict());
    }
    if !hash.is_empty() {
        let current = backend.read(path, Some(LIMIT)).await.map_err(io_error)?;
        if current.len() > LIMIT || content_hash(&current) != hash {
            return Err(conflict());
        }
    }
    Ok(Some(info))
}

pub(super) async fn save(
    backend: &FileBackend,
    path: &str,
    content: &[u8],
    time: &str,
    hash: &str,
    create_new: bool,
) -> Result<FileInfo, CommandError> {
    save_with_hook(backend, path, content, time, hash, create_new, || async {}).await
}
async fn save_with_hook<F, Fut>(
    backend: &FileBackend,
    path: &str,
    content: &[u8],
    time: &str,
    hash: &str,
    create_new: bool,
    hook: F,
) -> Result<FileInfo, CommandError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let existing = validate(backend, path, time, hash, create_new).await?;
    if existing.is_some() && !backend.supports_atomic_replace() {
        return Err(CommandError::new(
            "ATOMIC_SAVE_UNSUPPORTED",
            "服务器不支持安全替换，本地内容已保留，请另存为新文件",
        ));
    }
    let parent = path
        .rsplit_once('/')
        .map_or(".", |(p, _)| if p.is_empty() { "/" } else { p });
    let temp = join_path(parent, &format!(".eizhu-edit-{}.tmp", uuid::Uuid::new_v4()));
    let result = async {
        backend
            .write_private_new(&temp, content)
            .await
            .map_err(io_error)?;
        if existing.is_some() {
            backend
                .copy_permissions(path, &temp)
                .await
                .map_err(io_error)?;
        }
        hook().await;
        validate(backend, path, time, hash, create_new).await?;
        backend
            .commit_staged(&temp, path, existing.is_some())
            .await
            .map_err(io_error)?;
        backend.stat(path).await.map_err(io_error)
    }
    .await;
    // Failed save never discards the editor buffer and removes only our own staging path.
    let _ = backend.remove_file(&temp).await;
    result
}

#[cfg(test)]
mod tests {
    use super::super::backend::format_time;
    use super::*;
    #[tokio::test]
    async fn save_replaces_via_staging_and_create_new_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("配置.txt").to_string_lossy().into_owned();
        let backend = FileBackend::Local;
        save(&backend, &path, b"original", "", "", true)
            .await
            .unwrap();
        let info = backend.stat(&path).await.unwrap();
        save(
            &backend,
            &path,
            b"new",
            &format_time(info.modified),
            &content_hash(b"original"),
            false,
        )
        .await
        .unwrap();
        assert_eq!(backend.read(&path, None).await.unwrap(), b"new");
        assert_eq!(
            save(&backend, &path, b"overwrite", "", "", true)
                .await
                .unwrap_err()
                .code,
            "FILE_MODIFIED"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn staging_and_replacement_preserve_private_permissions_and_reject_symlinks() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("private").to_string_lossy().into_owned();
        let backend = FileBackend::Local;
        std::fs::write(&path, b"original").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        let before = std::fs::metadata(&path).unwrap();
        save_with_hook(
            &backend,
            &path,
            b"new",
            &format_time(before.modified().unwrap()),
            &content_hash(b"original"),
            false,
            || async {
                let temp = std::fs::read_dir(dir.path())
                    .unwrap()
                    .filter_map(Result::ok)
                    .find(|f| f.file_name().to_string_lossy().starts_with(".eizhu-edit-"))
                    .unwrap();
                assert_eq!(
                    std::fs::metadata(temp.path()).unwrap().permissions().mode() & 0o777,
                    0o640
                );
            },
        )
        .await
        .unwrap();
        let after = std::fs::metadata(&path).unwrap();
        assert_eq!(after.permissions().mode() & 0o777, 0o640);
        assert_eq!((before.uid(), before.gid()), (after.uid(), after.gid()));
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert_eq!(
            save(&backend, link.to_str().unwrap(), b"bad", "", "", false)
                .await
                .unwrap_err()
                .code,
            "ATOMIC_SAVE_UNSUPPORTED"
        );
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }

    #[tokio::test]
    async fn changes_during_staging_and_hash_mismatch_keep_the_external_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file").to_string_lossy().into_owned();
        let backend = FileBackend::Local;
        std::fs::write(&path, b"original").unwrap();
        let time = format_time(backend.stat(&path).await.unwrap().modified);
        assert_eq!(
            save(
                &backend,
                &path,
                b"local",
                &time,
                &content_hash(b"different"),
                false
            )
            .await
            .unwrap_err()
            .code,
            "FILE_MODIFIED"
        );
        let error = save_with_hook(
            &backend,
            &path,
            b"local",
            &time,
            &content_hash(b"original"),
            false,
            || async { std::fs::write(&path, b"external").unwrap() },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "FILE_MODIFIED");
        assert_eq!(std::fs::read(&path).unwrap(), b"external");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
