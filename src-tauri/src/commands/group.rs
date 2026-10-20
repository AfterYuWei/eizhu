use tauri::State;

use crate::{
    error::CommandError,
    group::{Group, GroupCreateRequest, GroupUpdateRequest},
};

#[tauri::command]
pub(crate) async fn group_list(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<Group>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .groups
        .clone();
    let service = service.clone();
    tauri::async_runtime::spawn_blocking(move || service.list())
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn group_create(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    request: GroupCreateRequest,
    workspace_generation: Option<u64>,
) -> Result<Group, CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let service = workspace.groups.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let service = service.clone();
    let group = tauri::async_runtime::spawn_blocking(move || service.create(request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(group)
}

#[tauri::command]
pub(crate) async fn group_update(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    request: GroupUpdateRequest,
    workspace_generation: Option<u64>,
) -> Result<Group, CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let service = workspace.groups.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let service = service.clone();
    let group = tauri::async_runtime::spawn_blocking(move || service.update(&id, request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(group)
}

#[tauri::command]
pub(crate) async fn group_delete(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let service = workspace.groups.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let service = service.clone();
    tauri::async_runtime::spawn_blocking(move || service.delete(&id))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(())
}
