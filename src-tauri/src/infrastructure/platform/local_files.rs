//! Process-visible local filesystem path adapter.
//!
//! Mobile currently exposes only paths visible inside the application sandbox. Content URI and
//! security-scoped URL support belongs at this boundary rather than in the SFTP feature.

use std::path::{Path, PathBuf};

pub(crate) fn home_dir() -> String {
    dirs::home_dir()
        .as_deref()
        .map(path_to_api)
        .unwrap_or_else(|| "/".into())
}

#[cfg(windows)]
pub(crate) fn path_to_api(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.as_bytes().get(1) == Some(&b':') {
        format!("/{value}")
    } else {
        value
    }
}

#[cfg(not(windows))]
pub(crate) fn path_to_api(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(windows)]
pub(crate) fn path_from_api(path: &str) -> PathBuf {
    windows_path_from_api(path)
}

#[cfg(any(windows, test))]
fn windows_path_from_api(path: &str) -> PathBuf {
    let clean = clean_api_path(path);
    if clean.len() >= 3
        && clean.as_bytes()[0] == b'/'
        && clean.as_bytes()[1].is_ascii_alphabetic()
        && clean.as_bytes()[2] == b':'
    {
        let mut native = clean[1..].replace('/', "\\");
        // Cleaning `/C:/` removes its trailing slash. Restore the drive root so it
        // cannot be interpreted as the drive-relative path `C:`.
        if clean.len() == 3 {
            native.push('\\');
        }
        PathBuf::from(native)
    } else {
        PathBuf::from(clean.replace('/', "\\"))
    }
}

#[cfg(not(windows))]
pub(crate) fn path_from_api(path: &str) -> PathBuf {
    PathBuf::from(clean_api_path(path))
}

#[cfg(unix)]
pub(crate) fn mode(metadata: &std::fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    format!("{:o}", metadata.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
pub(crate) fn mode(metadata: &std::fs::Metadata) -> String {
    if metadata.permissions().readonly() {
        "r--r--r--"
    } else {
        "rw-rw-rw-"
    }
    .into()
}

fn clean_api_path(path: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_drive_roots_resolve_to_absolute_native_paths() {
        for path in ["/C:", "/C:/", "/C:/Users/..", "/C:/Users/yuwei/../.."] {
            assert_eq!(windows_path_from_api(path), PathBuf::from("C:\\"), "{path}");
        }
        for path in ["/d:", "/d:/"] {
            assert_eq!(windows_path_from_api(path), PathBuf::from("d:\\"), "{path}");
        }
    }

    #[test]
    fn windows_local_navigation_preserves_directory_paths() {
        for (path, expected) in [
            ("/C:/Users/yuwei", r"C:\Users\yuwei"),
            ("/C:/Users", r"C:\Users"),
            ("/", r"\"),
        ] {
            assert_eq!(
                windows_path_from_api(path),
                PathBuf::from(expected),
                "{path}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_drive_root_can_be_listed_after_navigating_up() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().ancestors().last().unwrap();
        let api_root = path_to_api(root);
        for path in [api_root.as_str(), api_root.trim_end_matches('/')] {
            let native = path_from_api(path);
            assert_eq!(native, root);
            assert!(native.is_absolute());
            std::fs::read_dir(native).unwrap();
        }
    }

    #[test]
    fn api_paths_cannot_escape_their_root() {
        assert_eq!(path_to_api(&path_from_api("/a/../../b")), "/b");
        assert_eq!(path_to_api(&path_from_api("a/../b")), "b");
    }
}
