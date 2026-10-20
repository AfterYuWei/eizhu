//! 本地版本、云端 Provider 与调度的独立备份领域。

mod cloud;
mod error;
mod model;
mod oauth;
mod provider;
mod repository;
mod scheduler;
mod service;

pub(crate) use model::{
    BackupEvent, BackupSettings, BackupStatus, BackupTargetConfig, BackupTargetMeta, BackupVersion,
};
pub(crate) use repository::ArchiveRepository;
pub(crate) use service::{ArchiveService, BackupNowResult, RestoreResult, ORIGIN_MANUAL};
