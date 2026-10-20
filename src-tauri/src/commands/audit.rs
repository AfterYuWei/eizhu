use tauri::State;

use crate::{audit::AuditLog, error::CommandError};

#[tauri::command]
pub(crate) async fn audit_list(
    repository_workspace: State<'_, crate::app::WorkspaceManager>,
    profile_id: Option<String>,
    limit: Option<i64>,
    workspace_generation: Option<u64>,
) -> Result<Vec<AuditLog>, CommandError> {
    let repository = repository_workspace
        .current(workspace_generation)?
        .audit
        .clone();
    let repository = repository.clone();
    tauri::async_runtime::spawn_blocking(move || {
        repository.list(profile_id.as_deref(), limit.unwrap_or(100))
    })
    .await
    .map_err(CommandError::database)?
}
