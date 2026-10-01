use tauri::State;

use crate::{
    error::CommandError,
    profile::{Profile, ProfileCreateRequest, ProfileUpdateRequest},
};

#[tauri::command]
pub(crate) async fn profile_list(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    group_id: Option<String>,
    search: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<Vec<Profile>, CommandError> {
    let state = state_workspace
        .current(workspace_generation)?
        .profile
        .clone();
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || state.list(group_id.as_deref(), search.as_deref()))
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn profile_get(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<Profile, CommandError> {
    let state = state_workspace
        .current(workspace_generation)?
        .profile
        .clone();
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || state.get(&id))
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn profile_create(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    request: ProfileCreateRequest,
    workspace_generation: Option<u64>,
) -> Result<Profile, CommandError> {
    let workspace = state_workspace.current(workspace_generation)?;
    let state = workspace.profile.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let state = state.clone();
    let profile = tauri::async_runtime::spawn_blocking(move || state.create(request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(profile)
}

#[tauri::command]
pub(crate) async fn profile_update(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    request: ProfileUpdateRequest,
    workspace_generation: Option<u64>,
) -> Result<Profile, CommandError> {
    let workspace = state_workspace.current(workspace_generation)?;
    let state = workspace.profile.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let state = state.clone();
    let profile = tauri::async_runtime::spawn_blocking(move || state.update(&id, request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(profile)
}

#[tauri::command]
pub(crate) async fn profile_delete(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let workspace = state_workspace.current(workspace_generation)?;
    let state = workspace.profile.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || state.delete(&id))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(())
}
