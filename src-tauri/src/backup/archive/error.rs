//! Typed runtime failures for backup coordination and scheduling.

use crate::error::CommandError;

#[derive(Debug, thiserror::Error)]
pub(super) enum ArchiveError {
    #[error("备份操作进行中，请稍后")]
    InProgress,
    #[error("备份调度器锁已损坏")]
    SchedulerPoisoned,
    #[error("备份调度器尚未启动")]
    SchedulerNotStarted,
    #[error("备份请求队列已满，请稍后重试")]
    SchedulerBusy,
    #[error("备份调度器已停止")]
    SchedulerStopped,
}

impl From<ArchiveError> for CommandError {
    fn from(error: ArchiveError) -> Self {
        let code = match &error {
            ArchiveError::InProgress => "SYNC_IN_PROGRESS",
            ArchiveError::SchedulerBusy => "SYNC_SCHEDULER_BUSY",
            ArchiveError::SchedulerNotStarted | ArchiveError::SchedulerStopped => {
                "SYNC_SCHEDULER_STOPPED"
            }
            ArchiveError::SchedulerPoisoned => "SYNC_FAILED",
        };
        Self::new(code, error.to_string())
    }
}
