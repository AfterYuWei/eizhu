//! Desktop-only Tauri IPC adapters.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::{infrastructure::platform::desktop, sftp::SftpService};

const EDITOR_WINDOW_LABEL: &str = "editor";
const EDITOR_OPEN_FILE_EVENT: &str = "eizhu-editor-open-file";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorOpenRequest {
    session_id: String,
    session_type: String,
    path: String,
}

#[derive(Default)]
struct EditorWindowState {
    ready: bool,
    creating: bool,
    pending: Vec<EditorOpenRequest>,
}

/// Coordinates requests from the main webview with the lazily-created editor webview.
#[derive(Default)]
pub(crate) struct EditorWindowCoordinator(Mutex<EditorWindowState>);

impl EditorWindowCoordinator {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, EditorWindowState>, String> {
        self.0
            .lock()
            .map_err(|_| "编辑器窗口状态不可用".to_string())
    }

    fn reset_creation(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.creating = false;
            state.ready = false;
        }
    }

    fn requeue(&self, requests: Vec<EditorOpenRequest>) {
        if let Ok(mut state) = self.0.lock() {
            let mut pending = requests;
            pending.append(&mut state.pending);
            state.pending = pending;
        }
    }
}

fn emit_editor_requests(
    app: &AppHandle,
    coordinator: &EditorWindowCoordinator,
    requests: Vec<EditorOpenRequest>,
) -> Result<(), String> {
    for (index, request) in requests.iter().enumerate() {
        if let Err(error) =
            app.emit_to(EDITOR_WINDOW_LABEL, EDITOR_OPEN_FILE_EVENT, request.clone())
        {
            coordinator.requeue(requests[index..].to_vec());
            return Err(error.to_string());
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn open_editor_window(
    app: AppHandle,
    coordinator: State<'_, EditorWindowCoordinator>,
    session_id: String,
    session_type: String,
    path: String,
) -> Result<(), String> {
    if !matches!(session_type.as_str(), "sftp" | "serverDetail") {
        return Err("不支持的编辑器会话类型".to_string());
    }

    let existing = app.get_webview_window(EDITOR_WINDOW_LABEL);
    let (create_window, ready_requests) = {
        let mut state = coordinator.lock()?;
        if existing.is_none() {
            state.ready = false;
            state.creating = false;
        }
        state.pending.push(EditorOpenRequest {
            session_id,
            session_type,
            path,
        });

        if state.ready && existing.is_some() {
            (false, std::mem::take(&mut state.pending))
        } else if existing.is_none() && !state.creating {
            state.creating = true;
            (true, Vec::new())
        } else {
            (false, Vec::new())
        }
    };

    if create_window {
        let decorations = cfg!(target_os = "macos");
        let app_for_build = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            WebviewWindowBuilder::new(
                &app_for_build,
                EDITOR_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("eizhu — 编辑器")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .resizable(true)
            .decorations(decorations)
            .visible(false)
            .center()
            .build()
            .map(|_| ())
            .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?;
        if let Err(error) = result {
            coordinator.reset_creation();
            return Err(error);
        }
    }

    if !ready_requests.is_empty() {
        emit_editor_requests(&app, &coordinator, ready_requests)?;
    }

    if let Some(window) = existing {
        let ready = coordinator.lock()?.ready;
        if ready {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn editor_window_ready(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: State<'_, EditorWindowCoordinator>,
) -> Result<(), String> {
    if window.label() != EDITOR_WINDOW_LABEL {
        return Err("该命令仅供编辑器窗口调用".to_string());
    }

    let requests = {
        let mut state = coordinator.lock()?;
        state.ready = true;
        state.creating = false;
        std::mem::take(&mut state.pending)
    };

    let emit_result = emit_editor_requests(&app, &coordinator, requests);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    emit_result
}

#[tauri::command]
pub(crate) fn frontend_ready(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.maximize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub(crate) fn get_platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
pub(crate) fn read_app_log(kind: String) -> Result<desktop::AppLogSnapshot, String> {
    desktop::read_app_log(kind).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn append_frontend_log(lines: Vec<String>) -> Result<(), String> {
    desktop::append_frontend_log(lines).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn clear_app_log(kind: String) -> Result<(), String> {
    desktop::clear_app_log(kind).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn migrate_electron_settings() -> Option<serde_json::Value> {
    desktop::read_unmigrated()
}

#[tauri::command]
pub(crate) fn mark_electron_settings_migrated() -> Result<(), String> {
    desktop::mark_migrated().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn save_blob_to_disk(
    app: AppHandle,
    bytes: Vec<u8>,
    suggested_name: String,
) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || desktop::save_blob(&app, &bytes, &suggested_name))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn sftp_drag_out(
    service: State<'_, SftpService>,
    source_session_id: String,
    local_session_id: String,
    paths: Vec<String>,
) -> Result<desktop::DragOutFiles, String> {
    desktop::materialize_drag(service.inner(), source_session_id, local_session_id, paths)
        .await
        .map_err(|error| error.to_string())
}
