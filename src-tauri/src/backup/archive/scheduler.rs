use std::{future::pending, time::Duration};

use chrono::{Local, NaiveTime, TimeZone};
use tokio::{
    runtime::Handle,
    sync::mpsc,
    time::{Instant, Sleep},
};

use crate::error::CommandError;

use super::{
    error::ArchiveError,
    service::{ArchiveService, ORIGIN_CHANGE, ORIGIN_SCHEDULED, ORIGIN_SHUTDOWN},
};

const CHANNEL_CAPACITY: usize = 32;

pub(super) struct SchedulerRuntime {
    sender: mpsc::Sender<Message>,
    task: tokio::task::JoinHandle<()>,
    cancel: tokio_util::sync::CancellationToken,
}

enum Message {
    Reload,
    Change,
    Sync,
    Push,
    Stop,
}

impl ArchiveService {
    pub fn start_scheduler(&self, runtime: &Handle) -> Result<(), CommandError> {
        let mut slot = self
            .inner
            .scheduler
            .lock()
            .map_err(|_| ArchiveError::SchedulerPoisoned)?;
        if slot.is_some() {
            return Ok(());
        }
        let (sender, receiver) = mpsc::channel(CHANNEL_CAPACITY);
        let state = self.clone();
        let cancel = tokio_util::sync::CancellationToken::new();
        let owned = cancel.clone();
        let task = runtime.spawn(async move { run(state, receiver, owned).await });
        *slot = Some(SchedulerRuntime {
            sender,
            task,
            cancel,
        });
        Ok(())
    }

    pub(crate) fn notify_change(&self) {
        if let Err(error) = self.send_scheduler(Message::Change) {
            crate::app::log_runtime_error("sync_change_queue_failed", &error.to_string());
        }
    }

    pub(crate) fn reload_scheduler(&self) -> Result<(), CommandError> {
        self.send_scheduler(Message::Reload).map_err(Into::into)
    }

    pub(crate) fn request_sync(&self) -> Result<(), CommandError> {
        self.send_scheduler(Message::Sync).map_err(Into::into)
    }

    pub(crate) fn request_push(&self) -> Result<(), CommandError> {
        self.send_scheduler(Message::Push).map_err(Into::into)
    }

    fn send_scheduler(&self, message: Message) -> Result<(), ArchiveError> {
        let slot = self
            .inner
            .scheduler
            .lock()
            .map_err(|_| ArchiveError::SchedulerPoisoned)?;
        let runtime = slot.as_ref().ok_or(ArchiveError::SchedulerNotStarted)?;
        runtime
            .sender
            .try_send(message)
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => ArchiveError::SchedulerBusy,
                mpsc::error::TrySendError::Closed(_) => ArchiveError::SchedulerStopped,
            })
    }

    pub async fn stop_scheduler(&self) {
        let runtime = self
            .inner
            .scheduler
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());
        if let Some(runtime) = runtime {
            runtime.cancel.cancel();
            let _ = runtime.sender.try_send(Message::Stop);
            let _ = runtime.task.await;
        }
    }

    pub async fn shutdown_backup(&self) {
        let Ok(settings) = self.inner.repository.load_settings() else {
            return;
        };
        if !settings.auto_backup_enabled {
            return;
        }
        let state = self.clone();
        let result = tokio::task::spawn_blocking(move || state.create_version(ORIGIN_SHUTDOWN))
            .await
            .map_err(|error| CommandError::new("SYNC_FAILED", format!("退出备份任务失败: {error}")))
            .and_then(|result| result);
        if let Err(error) = result {
            if error.code != "SYNC_PASSWORD_REQUIRED" {
                crate::app::log_runtime_error("shutdown_backup_failed", &error.to_string());
            }
        }
    }
}

async fn run(
    state: ArchiveService,
    mut receiver: mpsc::Receiver<Message>,
    cancel: tokio_util::sync::CancellationToken,
) {
    let mut scheduled_at = next_scheduled_in(&state).map(|delay| Instant::now() + delay);
    let mut debounce_at: Option<Instant> = None;
    let mut retry = tokio::time::interval(Duration::from_secs(30));
    retry.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => break,
            _ = retry.tick() => {
                let _ = state.retry_cloud_cleanup(&cancel).await;
                // synced_to is durable: discover unfinished targets again after a restart.
                // push_latest freezes the current version and skips targets already confirmed.
                if state.has_pending_upload().unwrap_or(false) {
                    if let Err(error) = state.push_latest_cancellable(&cancel).await {
                        crate::app::log_runtime_error("backup_retry_failed", &error.to_string());
                    }
                }
            }
            message = receiver.recv() => match message {
                Some(Message::Stop) | None => break,
                Some(Message::Reload) => {
                    scheduled_at = next_scheduled_in(&state).map(|delay| Instant::now() + delay);
                }
                Some(Message::Change) => {
                    let delay = state.inner.repository.load_settings()
                        .map(|settings| Duration::from_secs(settings.change_debounce_seconds.max(5) as u64))
                        .unwrap_or(Duration::from_secs(30));
                    debounce_at = Some(Instant::now() + delay);
                }
                Some(Message::Sync) => {
                    if let Err(error) = state.push_latest_cancellable(&cancel).await {
                        crate::app::log_runtime_error("manual_sync_failed", &error.to_string());
                    }
                }
                Some(Message::Push) => {
                    if let Err(error) = state.push_latest_cancellable(&cancel).await {
                        crate::app::log_runtime_error("manual_push_failed", &error.to_string());
                    }
                }
            },
            _ = sleep_optional(scheduled_at) => {
                fire(&state, ORIGIN_SCHEDULED, &cancel).await;
                scheduled_at = next_scheduled_in(&state).map(|delay| Instant::now() + delay);
            }
            _ = sleep_optional(debounce_at) => {
                debounce_at = None;
                fire(&state, ORIGIN_CHANGE, &cancel).await;
            }
        }
    }
}

async fn fire(
    state: &ArchiveService,
    origin: &'static str,
    cancel: &tokio_util::sync::CancellationToken,
) {
    let Ok(settings) = state.inner.repository.load_settings() else {
        return;
    };
    if origin == ORIGIN_SCHEDULED && !settings.scheduled_enabled {
        return;
    }
    if origin == ORIGIN_CHANGE && !settings.auto_backup_enabled {
        return;
    }
    let cloned = state.clone();
    // Join blocking SQLite/KDF work before releasing this workspace; network work is cancellable.
    let result = tokio::task::spawn_blocking(move || cloned.create_version(origin)).await;
    match result {
        Ok(Ok(Some(version))) => {
            crate::app::log_runtime_error(
                "sync_version_created",
                &format!(
                    "version={} origin={origin} size={}",
                    version.version, version.size
                ),
            );
            if let Err(error) = state.push_latest_cancellable(cancel).await {
                crate::app::log_runtime_error("automatic_cloud_push_failed", &error.to_string());
            }
        }
        Ok(Ok(None)) => {}
        Ok(Err(error)) if error.code == "SYNC_PASSWORD_REQUIRED" => {}
        Ok(Err(error)) => {
            state
                .inner
                .repository
                .log_event("", "backup", 0, false, &error.message);
        }
        Err(error) => state.inner.repository.log_event(
            "",
            "backup",
            0,
            false,
            &format!("调度任务异常结束: {error}"),
        ),
    }
}

fn next_scheduled_in(state: &ArchiveService) -> Option<Duration> {
    let settings = state.inner.repository.load_settings().ok()?;
    if !settings.scheduled_enabled {
        return None;
    }
    let mut delays = Vec::with_capacity(2);
    if settings.scheduled_interval_hours > 0 {
        delays.push(Duration::from_secs(
            settings.scheduled_interval_hours as u64 * 3600,
        ));
    }
    if let Ok(time) = NaiveTime::parse_from_str(&settings.scheduled_daily_time, "%H:%M") {
        let now = Local::now();
        let mut next = Local
            .from_local_datetime(&now.date_naive().and_time(time))
            .single()?;
        if next <= now {
            next += chrono::Duration::days(1);
        }
        if let Ok(delay) = (next - now).to_std() {
            delays.push(delay);
        }
    }
    delays.into_iter().min()
}

async fn sleep_optional(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => {
            let sleep: Sleep = tokio::time::sleep_until(deadline);
            sleep.await;
        }
        None => pending::<()>().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::archive::model::BackupSettings;

    #[test]
    fn daily_and_interval_choose_earlier_deadline() {
        let now = Local::now();
        let daily = (now + chrono::Duration::minutes(10))
            .format("%H:%M")
            .to_string();
        let mut settings = BackupSettings::default();
        settings.scheduled_enabled = true;
        settings.scheduled_interval_hours = 2;
        settings.scheduled_daily_time = daily;
        let mut delays = vec![Duration::from_secs(
            settings.scheduled_interval_hours as u64 * 3600,
        )];
        let time = NaiveTime::parse_from_str(&settings.scheduled_daily_time, "%H:%M").unwrap();
        let mut next = Local
            .from_local_datetime(&now.date_naive().and_time(time))
            .single()
            .unwrap();
        if next <= now {
            next += chrono::Duration::days(1);
        }
        delays.push((next - now).to_std().unwrap());
        assert!(delays.into_iter().min().unwrap() < Duration::from_secs(7200));
    }
}
