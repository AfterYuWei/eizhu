//! Tauri IPC adapters for the eizhu account session.

use tauri::State;

use crate::{
    account::{AccountService, AccountStatus, AccountUser},
    error::CommandError,
};

#[tauri::command]
pub(crate) async fn account_status(
    service: State<'_, AccountService>,
) -> Result<AccountStatus, CommandError> {
    service.status().await
}

#[tauri::command]
pub(crate) async fn account_login(
    service: State<'_, AccountService>,
    email: String,
    password: String,
    workspace: State<'_, crate::app::WorkspaceManager>,
) -> Result<AccountStatus, CommandError> {
    let password = zeroize::Zeroizing::new(password);
    let result = service.login(email.trim(), &password).await?;
    workspace.activate_account().await?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn account_register(
    service: State<'_, AccountService>,
    email: String,
    password: String,
    workspace: State<'_, crate::app::WorkspaceManager>,
) -> Result<AccountStatus, CommandError> {
    let password = zeroize::Zeroizing::new(password);
    let result = service.register(email.trim(), &password).await?;
    workspace.activate_account().await?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn account_logout(
    service: State<'_, AccountService>,
    workspace: State<'_, crate::app::WorkspaceManager>,
) -> Result<(), CommandError> {
    workspace.activate(0).await?;
    service.logout().await
}

#[tauri::command]
pub(crate) async fn account_me(
    service: State<'_, AccountService>,
) -> Result<AccountUser, CommandError> {
    service.me().await
}

#[tauri::command]
pub(crate) async fn account_set_sync_enabled(
    service: State<'_, AccountService>,
    enabled: bool,
) -> Result<AccountStatus, CommandError> {
    service.set_sync_enabled(enabled).await
}

#[tauri::command]
pub(crate) async fn workspace_status(
    workspace: State<'_, crate::app::WorkspaceManager>,
) -> Result<crate::app::WorkspaceStatus, CommandError> {
    workspace.status()
}
#[tauri::command]
pub(crate) async fn workspace_activate(
    workspace: State<'_, crate::app::WorkspaceManager>,
    user_id: i64,
) -> Result<(), CommandError> {
    if user_id == 0 {
        workspace.activate(0).await
    } else {
        workspace.activate_account().await
    }
}

#[tauri::command]
pub(crate) async fn workspace_import_local(
    workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    workspace.import_local(workspace_generation).await
}
