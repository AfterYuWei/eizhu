//! Desktop-only Tauri IPC adapters.
use crate::infrastructure::platform::desktop;
pub(crate) use desktop::EditorWindowCoordinator;
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn open_editor_window(
    app: AppHandle,
    coordinator: State<'_, EditorWindowCoordinator>,
    session_id: String,
    session_type: String,
    path: String,
) -> Result<(), String> {
    desktop::open_editor_window(app, &coordinator, session_id, session_type, path).await
}
#[tauri::command]
pub(crate) fn request_app_close(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: State<'_, EditorWindowCoordinator>,
) -> Result<(), String> {
    desktop::request_app_close(app, window, &coordinator)
}
#[tauri::command(rename_all = "camelCase")]
pub(crate) fn resolve_app_close(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: State<'_, EditorWindowCoordinator>,
    should_close: bool,
) -> Result<(), String> {
    desktop::resolve_app_close(app, window, &coordinator, should_close)
}
#[tauri::command]
pub(crate) fn editor_window_show(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: State<'_, EditorWindowCoordinator>,
) -> Result<(), String> {
    desktop::editor_window_show(app, window, &coordinator)
}
#[tauri::command]
pub(crate) fn editor_window_ready(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: State<'_, EditorWindowCoordinator>,
) -> Result<(), String> {
    desktop::editor_window_ready(app, window, &coordinator)
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
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    source_session_id: String,
    local_session_id: String,
    paths: Vec<String>,
    workspace_generation: Option<u64>,
) -> Result<desktop::DragOutFiles, String> {
    let service = service_workspace
        .current(workspace_generation)
        .map_err(|error| error.to_string())?
        .sftp
        .clone();
    desktop::materialize_drag(&service, source_session_id, local_session_id, paths)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn request_editor_transition(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: State<'_, EditorWindowCoordinator>,
) -> Result<bool, String> {
    desktop::request_editor_transition(app, window, &coordinator).await
}
#[tauri::command]
pub(crate) fn resolve_editor_transition(
    window: WebviewWindow,
    coordinator: State<'_, EditorWindowCoordinator>,
    request_id: String,
    accepted: bool,
) -> Result<(), String> {
    desktop::resolve_editor_transition(window, &coordinator, request_id, accepted)
}
