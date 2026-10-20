//! Tauri IPC adapters for backup synchronization and cloud providers.

use serde::Serialize;
use tauri::State;

use crate::{
    backup::archive::{
        BackupEvent, BackupNowResult, BackupSettings, BackupStatus, BackupTargetConfig,
        BackupTargetMeta, BackupVersion, RestoreResult, ORIGIN_MANUAL,
    },
    error::CommandError,
};

#[derive(Serialize)]
pub(crate) struct SavedResult {
    saved: bool,
}

#[derive(Serialize)]
pub(crate) struct StartedResult {
    started: bool,
}

#[derive(Serialize)]
pub(crate) struct ResolvedResult {
    resolved: bool,
    version: Option<BackupVersion>,
}

#[derive(Serialize)]
pub(crate) struct PasswordResult {
    pub(super) backup_password: String,
}

#[derive(Serialize)]
pub(crate) struct OAuthURLResult {
    url: String,
}

#[tauri::command]
pub(crate) async fn backup_status(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<BackupStatus, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.status().await
}

#[tauri::command]
pub(crate) async fn backup_backup_now(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<BackupNowResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    let version = tokio::task::spawn_blocking(move || owned.create_version(ORIGIN_MANUAL))
        .await
        .map_err(join_error)??;
    if version.is_some() {
        service.request_push()?;
    }
    Ok(BackupNowResult {
        created: version.is_some(),
        message: version
            .is_none()
            .then(|| "数据自上一版本以来没有变化".into()),
        version,
    })
}

#[tauri::command]
pub(crate) async fn backup_versions(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<BackupVersion>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.list_versions())
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub(crate) async fn backup_restore_version(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<RestoreResult, CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let service = workspace.archive.clone();
    let owned = service.clone();
    let version = tokio::task::spawn_blocking(move || owned.restore_version(&id))
        .await
        .map_err(join_error)??;
    workspace.sync.notify_change();
    service.request_push()?;
    Ok(RestoreResult {
        restored: true,
        version,
    })
}

#[tauri::command]
pub(crate) async fn backup_delete_version(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    force: bool,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.delete_version_with_cloud(&id, force).await
}

#[tauri::command]
pub(crate) async fn backup_events(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    limit: Option<i64>,
    workspace_generation: Option<u64>,
) -> Result<Vec<BackupEvent>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.list_events(limit.unwrap_or(50)))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub(crate) async fn backup_get_settings(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<BackupSettings, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.get_settings())
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub(crate) async fn backup_update_settings(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    mut settings: BackupSettings,
    backup_password: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<SavedResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    settings.backup_password = backup_password.unwrap_or_default();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.save_settings(settings))
        .await
        .map_err(join_error)??;
    service.reload_scheduler()?;
    Ok(SavedResult { saved: true })
}

#[tauri::command]
pub(crate) async fn backup_reveal_password(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<PasswordResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    let backup_password = tokio::task::spawn_blocking(move || owned.reveal_password())
        .await
        .map_err(join_error)??;
    Ok(PasswordResult { backup_password })
}

#[tauri::command]
pub(crate) async fn backup_shutdown(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.shutdown_backup().await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn backup_submit_latest(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<StartedResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.request_sync()?;
    Ok(StartedResult { started: true })
}

#[tauri::command]
pub(crate) async fn backup_push(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<StartedResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.request_push()?;
    Ok(StartedResult { started: true })
}

#[tauri::command]
pub(crate) async fn backup_legacy_resolve_conflict(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    choice: String,
    workspace_generation: Option<u64>,
) -> Result<ResolvedResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let _ = (service, choice);
    return Err(CommandError::new(
        "BACKUP_NO_MERGE",
        "备份仅提交版本，不进行数据合并",
    ));
    #[allow(unreachable_code)]
    let version = None;
    Ok(ResolvedResult {
        resolved: true,
        version,
    })
}

#[tauri::command]
pub(crate) async fn backup_targets(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<BackupTargetMeta>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.list_providers())
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub(crate) async fn backup_create_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    config: BackupTargetConfig,
    workspace_generation: Option<u64>,
) -> Result<BackupTargetMeta, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.create_provider(config))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub(crate) async fn backup_update_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    config: BackupTargetConfig,
    workspace_generation: Option<u64>,
) -> Result<SavedResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.update_provider(&id, config))
        .await
        .map_err(join_error)??;
    Ok(SavedResult { saved: true })
}

#[tauri::command]
pub(crate) async fn backup_delete_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let owned = service.clone();
    tokio::task::spawn_blocking(move || owned.delete_provider(&id))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub(crate) async fn backup_test_provider(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<SavedResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.test_provider(&id).await?;
    Ok(SavedResult { saved: true })
}

#[tauri::command]
pub(crate) async fn backup_oauth_url(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    provider_type: String,
    provider_id: String,
    workspace_generation: Option<u64>,
) -> Result<OAuthURLResult, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    let url = service.build_oauth_url(&provider_type, &provider_id)?;
    Ok(OAuthURLResult { url })
}

#[tauri::command]
pub(crate) async fn backup_preview_version(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    password: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let versions = workspace.archive.list_versions()?;
    let version = versions
        .into_iter()
        .find(|v| v.id == id)
        .ok_or_else(|| CommandError::new("VERSION_NOT_FOUND", "备份版本不存在"))?;
    let password = zeroize::Zeroizing::new(match password {
        Some(value) => value,
        None => workspace.archive.reveal_password()?,
    });
    tokio::task::spawn_blocking(move || {
        let mut preview = workspace
            .backup
            .prepare_restore(&version.file_path, &password, Some(&version.hash))?;
        preview["source"] = serde_json::json!({"kind":"local_version","version":version.version,"createdAt":version.created_at,"origin":version.origin});
        Ok(preview)
    })
    .await
    .map_err(join_error)?
}
#[tauri::command]
pub(crate) async fn backup_apply_restore(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    token: String,
    mode: String,
    workspace_generation: Option<u64>,
) -> Result<crate::backup::BackupImportResult, CommandError> {
    let workspace = service_workspace.current(workspace_generation)?;
    let owned = workspace.clone();
    let result = tokio::task::spawn_blocking(move || owned.backup.apply_restore(&token, &mode))
        .await
        .map_err(join_error)??;
    workspace.sync.notify_change();
    workspace.archive.notify_change();
    Ok(result)
}

#[tauri::command]
pub(crate) async fn backup_safety_versions(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .backup
        .clone();
    tokio::task::spawn_blocking(move || service.safety_versions())
        .await
        .map_err(join_error)?
}
#[tauri::command]
pub(crate) async fn backup_preview_safety(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .backup
        .clone();
    tokio::task::spawn_blocking(move || service.preview_safety(&id))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub(crate) async fn backup_preview_legacy_account(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    password: String,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.preview_legacy_account(password).await
}

#[tauri::command]
pub(crate) async fn backup_cloud_versions(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    provider_id: String,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.cloud_versions(&provider_id).await
}
#[tauri::command]
pub(crate) async fn backup_preview_cloud(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    provider_id: String,
    object: String,
    password: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .archive
        .clone();
    service.preview_cloud(&provider_id, &object, password).await
}

fn join_error(error: tokio::task::JoinError) -> CommandError {
    CommandError::new("SYNC_FAILED", format!("后台任务异常结束: {error}"))
}
