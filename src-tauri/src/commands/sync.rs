//! Account item synchronization IPC. Backups have their own commands.
use crate::{
    error::CommandError,
    sync::{Conflict, SyncStatus},
};
use tauri::State;
#[tauri::command]
pub(crate) async fn sync_status(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<SyncStatus, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sync
        .clone();
    tokio::task::spawn_blocking(move || service.status())
        .await
        .map_err(CommandError::database)?
}
#[tauri::command]
pub(crate) async fn sync_now(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sync
        .clone();
    service.retry_now();
    Ok(())
}
#[tauri::command]
pub(crate) async fn sync_unlock(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    password: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sync
        .clone();
    service.unlock(password).await
}
#[tauri::command]
pub(crate) async fn sync_change_password(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    password: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sync
        .clone();
    service.change_password(password).await
}
#[tauri::command]
pub(crate) async fn sync_conflicts(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<Conflict>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sync
        .clone();
    tokio::task::spawn_blocking(move || service.conflicts())
        .await
        .map_err(CommandError::database)?
}
#[tauri::command]
pub(crate) async fn sync_resolve_conflict(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    item_type: String,
    item_id: String,
    choice: String,
    remote_revision: Option<i64>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sync
        .clone();
    service
        .resolve(&item_type, &item_id, &choice, remote_revision)
        .await
}
#[tauri::command]
pub(crate) async fn sync_preview(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sync
        .clone();
    service.preview().await
}
#[tauri::command]
pub(crate) async fn sync_bootstrap(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    token: String,
    mode: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let safety = workspace.backup.clone();
    tokio::task::spawn_blocking(move || safety.capture_safety())
        .await
        .map_err(CommandError::database)??;
    let service = workspace.sync.clone();
    service.bootstrap(&token, &mode).await
}
