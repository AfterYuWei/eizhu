use tauri::State;

use crate::{
    error::CommandError,
    vault::{
        generate_key_pair, Credential, GenerateKeyRequest, GenerateKeyResponse, ProfileRef,
        VaultItem, VaultWriteRequest,
    },
};

#[tauri::command]
pub(crate) async fn vault_list(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    vault_type: Option<String>,
    q: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<Vec<VaultItem>, CommandError> {
    let state = state_workspace.current(workspace_generation)?.vault.clone();
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || state.list(vault_type.as_deref(), q.as_deref()))
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn vault_get(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<VaultItem, CommandError> {
    let state = state_workspace.current(workspace_generation)?.vault.clone();
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || state.get(&id))
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn vault_create(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    request: VaultWriteRequest,
    workspace_generation: Option<u64>,
) -> Result<VaultItem, CommandError> {
    let workspace = state_workspace.current(workspace_generation)?;
    let state = workspace.vault.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let state = state.clone();
    let item = tauri::async_runtime::spawn_blocking(move || state.create(request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(item)
}

#[tauri::command]
pub(crate) async fn vault_update(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    request: VaultWriteRequest,
    workspace_generation: Option<u64>,
) -> Result<VaultItem, CommandError> {
    let workspace = state_workspace.current(workspace_generation)?;
    let state = workspace.vault.clone();
    let sync = workspace.sync.clone();
    let archive = workspace.archive.clone();
    let state = state.clone();
    let item = tauri::async_runtime::spawn_blocking(move || state.update(&id, request))
        .await
        .map_err(CommandError::database)??;
    sync.notify_change();
    archive.notify_change();
    Ok(item)
}

#[tauri::command]
pub(crate) async fn vault_delete(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let workspace = state_workspace.current(workspace_generation)?;
    let state = workspace.vault.clone();
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

#[tauri::command]
pub(crate) async fn vault_references(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<Vec<ProfileRef>, CommandError> {
    let state = state_workspace.current(workspace_generation)?.vault.clone();
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || state.references(&id))
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn vault_reveal(
    state_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<Credential, CommandError> {
    let state = state_workspace.current(workspace_generation)?.vault.clone();
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || state.reveal(&id))
        .await
        .map_err(CommandError::database)?
}

#[tauri::command]
pub(crate) async fn vault_generate_key_pair(
    request: GenerateKeyRequest,
) -> Result<GenerateKeyResponse, CommandError> {
    tauri::async_runtime::spawn_blocking(move || generate_key_pair(request))
        .await
        .map_err(CommandError::database)?
}
