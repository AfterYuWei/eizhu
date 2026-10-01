use tauri::State;

use crate::{
    error::CommandError,
    snippet::{Snippet, SnippetCreateRequest, SnippetUpdateRequest},
};

#[tauri::command]
pub(crate) async fn snippet_list(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<Snippet>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .snippets
        .clone();
    let service = service.clone();
    tauri::async_runtime::spawn_blocking(move || service.list())
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn snippet_create(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    request: SnippetCreateRequest,
    workspace_generation: Option<u64>,
) -> Result<Snippet, CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let service = workspace.snippets.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let service = service.clone();
    let snippet = tauri::async_runtime::spawn_blocking(move || service.create(request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(snippet)
}

#[tauri::command]
pub(crate) async fn snippet_update(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    request: SnippetUpdateRequest,
    workspace_generation: Option<u64>,
) -> Result<Snippet, CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let service = workspace.snippets.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let service = service.clone();
    let snippet = tauri::async_runtime::spawn_blocking(move || service.update(&id, request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(snippet)
}

#[tauri::command]
pub(crate) async fn snippet_delete(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let service = workspace.snippets.clone();
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
