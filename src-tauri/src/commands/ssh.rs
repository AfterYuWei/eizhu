//! Tauri IPC adapters for SSH profile tests and terminal sessions.

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use crate::{
    error::CommandError,
    profile::{ProfileCreateRequest, ProfileUpdateRequest},
    ssh::{
        self, ClientMessage, ProfileTestResult, SessionCreateRequest, SessionCreateResponse,
        SessionInfo,
    },
};

#[tauri::command]
pub(crate) async fn profile_test_new(
    profiles_workspace: State<'_, crate::app::WorkspaceManager>,
    request: ProfileCreateRequest,
    workspace_generation: Option<u64>,
) -> Result<ProfileTestResult, CommandError> {
    let profiles = profiles_workspace
        .current(workspace_generation)?
        .profile
        .clone();
    ssh::test_new_profile(&profiles, request).await
}

#[tauri::command]
pub(crate) async fn profile_test_existing(
    profiles_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    request: ProfileUpdateRequest,
    workspace_generation: Option<u64>,
) -> Result<ProfileTestResult, CommandError> {
    let profiles = profiles_workspace
        .current(workspace_generation)?
        .profile
        .clone();
    ssh::test_existing_profile(&profiles, id, request).await
}

#[tauri::command]
pub(crate) async fn profile_confirm_host_key(
    profiles_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    fingerprint: String,
    workspace_generation: Option<u64>,
) -> Result<Value, CommandError> {
    let profiles = profiles_workspace
        .current(workspace_generation)?
        .profile
        .clone();
    ssh::confirm_profile_host_key(&profiles, id, fingerprint).await
}

#[tauri::command]
pub(crate) async fn session_create(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    request: SessionCreateRequest,
    workspace_generation: Option<u64>,
) -> Result<SessionCreateResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.create(request).await
}

#[tauri::command]
pub(crate) async fn session_list(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<SessionInfo>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.list().await
}

#[tauri::command]
pub(crate) async fn session_attach(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<Vec<ClientMessage>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.attach(&id).await
}

#[tauri::command]
pub(crate) async fn session_subscribe(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    on_event: Channel<ClientMessage>,
    workspace_generation: Option<u64>,
) -> Result<String, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.subscribe(&id, on_event).await
}

#[tauri::command]
pub(crate) async fn session_unsubscribe(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    subscription_id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.unsubscribe(&id, &subscription_id).await
}

#[tauri::command]
pub(crate) async fn session_reconnect(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<SessionCreateResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.reconnect(&id).await
}

#[tauri::command]
pub(crate) async fn session_confirm_host_key(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    fingerprint: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.confirm_host_key(&id, fingerprint).await
}

#[tauri::command]
pub(crate) async fn host_key_decide(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    request_id: String,
    fingerprint: String,
    decision: String,
    workspace_generation: Option<u64>,
) -> Result<Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service
        .decide_host_key(&request_id, fingerprint, &decision)
        .await
}

#[tauri::command]
pub(crate) async fn session_input(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    data: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.input(&id, data).await
}

#[tauri::command]
pub(crate) async fn session_resize(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    cols: u32,
    rows: u32,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.resize(&id, cols, rows).await
}

#[tauri::command]
pub(crate) async fn session_ping(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.ping(&id).await
}

#[tauri::command]
pub(crate) async fn session_auth_respond(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    request_id: String,
    responses: Vec<String>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.respond_auth(&request_id, responses).await
}

#[tauri::command]
pub(crate) async fn session_complete(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    request_id: String,
    generator_id: String,
    params: crate::ssh::CompletionParams,
    cwd: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service
        .complete(&id, request_id, generator_id, params, cwd)
        .await
}

#[tauri::command]
pub(crate) async fn session_close(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sessions
        .clone();
    service.close(&id).await
}
