//! Tauri implementation of outbound feature event ports.

use tauri::{AppHandle, Emitter};

use crate::{sftp::SftpEventSink, ssh::SessionEventSink};

#[derive(Clone)]
pub(crate) struct TauriEventSink {
    app: AppHandle,
    scope: Option<(u64, std::sync::Arc<std::sync::atomic::AtomicU64>)>,
}

impl TauriEventSink {}

impl TauriEventSink {
    pub(crate) fn for_workspace(
        app: AppHandle,
        generation: u64,
        current: std::sync::Arc<std::sync::atomic::AtomicU64>,
    ) -> Self {
        Self {
            app,
            scope: Some((generation, current)),
        }
    }
    fn active(&self) -> bool {
        self.scope.as_ref().is_none_or(|(generation, current)| {
            *generation == current.load(std::sync::atomic::Ordering::Acquire)
        })
    }
}

impl SessionEventSink for TauriEventSink {
    fn emit_session(&self, mut payload: serde_json::Value) {
        if !self.active() {
            return;
        }
        if let Some((generation, _)) = &self.scope {
            payload["workspaceGeneration"] = serde_json::json!(generation);
        }
        let _ = self.app.emit("eizhu-session-message", payload);
    }
}

impl SftpEventSink for TauriEventSink {
    fn emit_sftp(&self, event_type: &'static str, payload: serde_json::Value) {
        if !self.active() {
            return;
        }
        let _ = self.app.emit(
            "eizhu-sftp-message",
            serde_json::json!({"type": event_type, "payload": payload, "workspaceGeneration": self.scope.as_ref().map(|(generation, _)| generation)}),
        );
    }
}
