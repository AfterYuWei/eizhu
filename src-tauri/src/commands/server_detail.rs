//! Tauri IPC adapters for server information gathered over an SFTP-owned SSH route.

use tauri::State;

use crate::{
    error::CommandError,
    server_detail::{self, ServerInfo, ServerMetrics},
};

#[tauri::command]
pub(crate) async fn server_get_info(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    workspace_generation: Option<u64>,
) -> Result<ServerInfo, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    server_detail::get_info(&service, session_id).await
}

#[tauri::command]
pub(crate) async fn server_get_metrics(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    workspace_generation: Option<u64>,
) -> Result<ServerMetrics, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    server_detail::get_metrics(&service, session_id).await
}
