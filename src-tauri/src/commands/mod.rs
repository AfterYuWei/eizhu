//! Tauri IPC adapter layer.

mod account;
mod audit;
mod backup;
mod backup_compat;
#[cfg(desktop)]
mod desktop;
mod document;
mod group;
mod legacy_backup;
pub(crate) use backup_compat::*;
mod lifecycle;
mod local_state;
mod platform;
mod profile;
mod server_detail;
mod sftp;
mod snippet;
mod ssh;
mod sync;
mod vault;

pub(crate) use account::*;
pub(crate) use audit::*;
pub(crate) use backup::*;
#[cfg(desktop)]
pub(crate) use desktop::*;
pub(crate) use document::*;
pub(crate) use group::*;
pub(crate) use legacy_backup::*;
pub(crate) use lifecycle::*;
pub(crate) use local_state::*;
pub(crate) use platform::*;
pub(crate) use profile::*;
pub(crate) use server_detail::*;
pub(crate) use sftp::*;
pub(crate) use snippet::*;
pub(crate) use ssh::*;
pub(crate) use sync::*;
pub(crate) use vault::*;
