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
) -> Result<AccountStatus, CommandError> {
    service.login(email.trim(), &password).await
}

#[tauri::command]
pub(crate) async fn account_register(
    service: State<'_, AccountService>,
    email: String,
    password: String,
) -> Result<AccountStatus, CommandError> {
    service.register(email.trim(), &password).await
}

#[tauri::command]
pub(crate) async fn account_logout(service: State<'_, AccountService>) -> Result<(), CommandError> {
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
