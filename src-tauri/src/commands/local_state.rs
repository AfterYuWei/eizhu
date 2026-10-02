use crate::{
    app::WorkspaceManager,
    error::CommandError,
    local_state::{HistoryEntry, LocalStateKey},
};
use tauri::State;

#[tauri::command]
pub(crate) async fn local_state_read(
    workspace: State<'_, WorkspaceManager>,
    key: LocalStateKey,
    workspace_generation: Option<u64>,
) -> Result<Option<serde_json::Value>, CommandError> {
    let service = workspace.current(workspace_generation)?.local_state.clone();
    tauri::async_runtime::spawn_blocking(move || service.read(key))
        .await
        .map_err(CommandError::database)?
}
#[tauri::command]
pub(crate) async fn local_state_write(
    workspace: State<'_, WorkspaceManager>,
    key: LocalStateKey,
    value: serde_json::Value,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = workspace.current(workspace_generation)?.local_state.clone();
    tauri::async_runtime::spawn_blocking(move || service.write(key, value))
        .await
        .map_err(CommandError::database)?
}
#[tauri::command]
pub(crate) async fn history_list(
    workspace: State<'_, WorkspaceManager>,
    profile_id: String,
    workspace_generation: Option<u64>,
) -> Result<Vec<HistoryEntry>, CommandError> {
    let service = workspace.current(workspace_generation)?.local_state.clone();
    tauri::async_runtime::spawn_blocking(move || service.list(&profile_id))
        .await
        .map_err(CommandError::database)?
}
#[tauri::command]
pub(crate) async fn history_record(
    workspace: State<'_, WorkspaceManager>,
    profile_id: String,
    command: String,
    cwd: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = workspace.current(workspace_generation)?.local_state.clone();
    tauri::async_runtime::spawn_blocking(move || service.record(&profile_id, &command, &cwd))
        .await
        .map_err(CommandError::database)?
}
#[tauri::command]
pub(crate) async fn history_delete(
    workspace: State<'_, WorkspaceManager>,
    profile_id: Option<String>,
    id: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = workspace.current(workspace_generation)?.local_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.delete(profile_id.as_deref(), id.as_deref())
    })
    .await
    .map_err(CommandError::database)?
}
#[tauri::command]
pub(crate) async fn history_import(
    workspace: State<'_, WorkspaceManager>,
    profile_id: String,
    entries: Vec<HistoryEntry>,
    workspace_generation: Option<u64>,
) -> Result<usize, CommandError> {
    let service = workspace.current(workspace_generation)?.local_state.clone();
    tauri::async_runtime::spawn_blocking(move || service.import(&profile_id, entries))
        .await
        .map_err(CommandError::database)?
}
