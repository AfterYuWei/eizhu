use crate::{
    app::WorkspaceManager,
    error::CommandError,
    ssh::{TunnelConfig, TunnelStatus},
};
use tauri::State;
#[tauri::command]
pub(crate) async fn tunnel_list(
    workspaces: State<'_, WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<TunnelConfig>, CommandError> {
    workspaces.current(workspace_generation)?.tunnels.list()
}
#[tauri::command]
pub(crate) async fn tunnel_statuses(
    workspaces: State<'_, WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<TunnelStatus>, CommandError> {
    workspaces.current(workspace_generation)?.tunnels.statuses()
}
#[tauri::command]
pub(crate) async fn tunnel_save(
    workspaces: State<'_, WorkspaceManager>,
    config: TunnelConfig,
    workspace_generation: Option<u64>,
) -> Result<TunnelConfig, CommandError> {
    let service = workspaces.current(workspace_generation)?.tunnels.clone();
    service.save(config).await
}
#[tauri::command]
pub(crate) async fn tunnel_delete(
    workspaces: State<'_, WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = workspaces.current(workspace_generation)?.tunnels.clone();
    service.remove(&id).await
}
#[tauri::command]
pub(crate) async fn tunnel_start(
    workspaces: State<'_, WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<TunnelStatus, CommandError> {
    let service = workspaces.current(workspace_generation)?.tunnels.clone();
    service.start(&id).await
}
#[tauri::command]
pub(crate) async fn tunnel_stop(
    workspaces: State<'_, WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = workspaces.current(workspace_generation)?.tunnels.clone();
    service.stop(&id).await
}
