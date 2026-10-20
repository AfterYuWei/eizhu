use super::legacy_backup::{OAuthURLResult, SavedResult, StartedResult};
// One-release compatibility for backup commands formerly prefixed sync_.
use crate::{backup::archive::*, error::CommandError};
use tauri::State;
#[tauri::command]
pub(crate) async fn sync_backup_now(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<BackupNowResult, CommandError> {
    super::legacy_backup::backup_backup_now(service_workspace, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_versions(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<BackupVersion>, CommandError> {
    super::legacy_backup::backup_versions(service_workspace, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_restore_version(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<RestoreResult, CommandError> {
    super::legacy_backup::backup_restore_version(service_workspace, id, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_delete_version(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    force: bool,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    super::legacy_backup::backup_delete_version(service_workspace, id, force, workspace_generation)
        .await
}
#[tauri::command]
pub(crate) async fn sync_events(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    limit: Option<i64>,
    workspace_generation: Option<u64>,
) -> Result<Vec<BackupEvent>, CommandError> {
    super::legacy_backup::backup_events(service_workspace, limit, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_get_settings(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let settings =
        super::legacy_backup::backup_get_settings(service_workspace, workspace_generation).await?;
    let mut value = serde_json::to_value(settings).map_err(CommandError::database)?;
    if let Some(fields) = value.as_object_mut() {
        if let Some(flag) = fields.remove("backup_password_set") {
            fields.insert("sync_password_set".into(), flag);
        }
    }
    Ok(value)
}
#[tauri::command]
pub(crate) async fn sync_update_settings(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    settings: BackupSettings,
    sync_password: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<SavedResult, CommandError> {
    super::legacy_backup::backup_update_settings(
        service_workspace,
        settings,
        sync_password,
        workspace_generation,
    )
    .await
}
#[tauri::command]
pub(crate) async fn sync_reveal_password(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let value =
        super::legacy_backup::backup_reveal_password(service_workspace, workspace_generation)
            .await?;
    Ok(serde_json::json!({"sync_password":value.backup_password}))
}
#[tauri::command]
pub(crate) async fn sync_push(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<StartedResult, CommandError> {
    super::legacy_backup::backup_push(service_workspace, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_providers(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<BackupTargetMeta>, CommandError> {
    super::legacy_backup::backup_targets(service_workspace, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_create_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    config: BackupTargetConfig,
    workspace_generation: Option<u64>,
) -> Result<BackupTargetMeta, CommandError> {
    super::legacy_backup::backup_create_provider(service_workspace, config, workspace_generation)
        .await
}
#[tauri::command]
pub(crate) async fn sync_update_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    config: BackupTargetConfig,
    workspace_generation: Option<u64>,
) -> Result<SavedResult, CommandError> {
    super::legacy_backup::backup_update_provider(
        service_workspace,
        id,
        config,
        workspace_generation,
    )
    .await
}
#[tauri::command]
pub(crate) async fn sync_delete_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    super::legacy_backup::backup_delete_provider(service_workspace, id, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_test_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<SavedResult, CommandError> {
    super::legacy_backup::backup_test_provider(service_workspace, id, workspace_generation).await
}
#[tauri::command]
pub(crate) async fn sync_oauth_url(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    provider_type: String,
    provider_id: String,
    workspace_generation: Option<u64>,
) -> Result<OAuthURLResult, CommandError> {
    super::legacy_backup::backup_oauth_url(
        service_workspace,
        provider_type,
        provider_id,
        workspace_generation,
    )
    .await
}
#[tauri::command]
pub(crate) async fn sync_shutdown(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    super::legacy_backup::backup_shutdown(service_workspace, workspace_generation).await
}
