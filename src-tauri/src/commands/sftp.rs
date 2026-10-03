//! Tauri IPC adapters for SFTP sessions, file operations and transfers.

use tauri::{ipc::InvokeBody, State};

use crate::{error::CommandError, sftp};

#[tauri::command]
pub(crate) async fn sftp_create_session(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    profile_id: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpCreateSessionResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::create_session(&service, profile_id).await
}

#[tauri::command]
pub(crate) async fn sftp_get_session(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpSessionInfo, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::get_session(&service, id).await
}

#[tauri::command]
pub(crate) async fn sftp_reconnect_session(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpCreateSessionResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    service.reconnect(&id).await
}

#[tauri::command]
pub(crate) async fn sftp_host_key_decide(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    request_id: String,
    fingerprint: String,
    decision: String,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    service
        .decide_host_key(&request_id, fingerprint, &decision)
        .await
}

#[tauri::command]
pub(crate) async fn sftp_list_sessions(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<Vec<sftp::SftpSessionInfo>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::list_sessions(&service).await
}

#[tauri::command]
pub(crate) async fn sftp_close_session(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::close_session(&service, id).await
}

#[tauri::command]
pub(crate) async fn sftp_list(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    path: String,
    show_hidden: Option<bool>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpListResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::list(&service, session_id, path, show_hidden).await
}

#[tauri::command]
pub(crate) async fn sftp_stat(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    path: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpEntry, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::stat(&service, session_id, path).await
}

#[tauri::command]
pub(crate) async fn sftp_tree(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    path: String,
    depth: Option<u32>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpTreeResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::tree_entries(&service, session_id, path, depth).await
}

#[tauri::command]
pub(crate) async fn sftp_mkdir(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    path: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpEntry, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::mkdir(&service, session_id, path).await
}

#[tauri::command]
pub(crate) async fn sftp_rename(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    old_path: String,
    new_path: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpEntry, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::rename(&service, session_id, old_path, new_path).await
}

#[tauri::command]
pub(crate) async fn sftp_delete(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    paths: Vec<String>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpDeleteResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::delete(&service, session_id, paths).await
}

#[tauri::command]
pub(crate) async fn sftp_read_file(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    path: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpFileReadResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::read_file(&service, session_id, path).await
}

#[tauri::command]
pub(crate) async fn sftp_write_file(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    path: String,
    request: sftp::SftpFileWriteRequest,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpFileWriteResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::write_file(&service, session_id, path, request).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sftp_upload_begin(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    name: String,
    dest_dir: String,
    overwrite: bool,
    size: u64,
    last_modified: Option<u64>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpUploadBeginResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_upload_begin(
        &service,
        session_id,
        name,
        dest_dir,
        overwrite,
        size,
        last_modified,
    )
    .await
}

#[tauri::command]
pub(crate) async fn sftp_upload_chunk(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    request: tauri::ipc::Request<'_>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpUploadChunkResponse, CommandError> {
    let workspace_generation = workspace_generation.or_else(|| {
        request
            .headers()
            .get("x-eizhu-workspace-generation")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
    });
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    let upload_id = request
        .headers()
        .get("x-eizhu-upload-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| CommandError::new("VALIDATION", "upload id is required"))?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::new(
            "INVALID_FORM",
            "raw upload chunk is required",
        ));
    };
    let sequence = request
        .headers()
        .get("x-eizhu-chunk-sequence")
        .map(|value| {
            value
                .to_str()
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .ok_or_else(|| CommandError::new("VALIDATION", "上传块序号无效"))
        })
        .transpose()?;
    sftp::upload_chunk_sequenced(&service, upload_id, bytes, sequence).await
}

#[tauri::command]
pub(crate) async fn sftp_upload_chunk_base64(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    upload_id: String,
    data: String,
    sequence: Option<u64>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpUploadChunkResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_upload_chunk_base64(&service, upload_id, data, sequence).await
}

#[tauri::command]
pub(crate) async fn sftp_upload_finish(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    upload_id: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpUploadResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_upload_finish(&service, upload_id).await
}

#[tauri::command]
pub(crate) async fn sftp_upload_abort(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    upload_id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_upload_abort(&service, upload_id).await
}

#[tauri::command]
pub(crate) async fn sftp_download(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    paths: Vec<String>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpDownloadResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_download(&service, session_id, paths).await
}

#[tauri::command]
pub(crate) async fn sftp_download_chunk(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    offset: u64,
    max_bytes: u32,
    workspace_generation: Option<u64>,
) -> Result<tauri::ipc::Response, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    let bytes = sftp::sftp_download_chunk(&service, task_id, offset, max_bytes).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub(crate) async fn sftp_download_chunk_base64(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    offset: u64,
    max_bytes: u32,
    workspace_generation: Option<u64>,
) -> Result<String, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_download_chunk_base64(&service, task_id, offset, max_bytes).await
}

#[tauri::command]
pub(crate) async fn sftp_download_close(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_download_close(&service, task_id).await
}

#[tauri::command]
pub(crate) async fn sftp_list_transfers(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: Option<String>,
    status: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<Vec<sftp::TransferTask>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_list_transfers(&service, session_id, status).await
}

#[tauri::command]
pub(crate) async fn sftp_cancel_transfer(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_cancel_transfer(&service, task_id).await
}

#[tauri::command]
pub(crate) async fn sftp_clear_completed_transfers(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    workspace_generation: Option<u64>,
) -> Result<(), CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_clear_completed_transfers(&service).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sftp_transfer(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    source_session_id: String,
    target_session_id: String,
    paths: Vec<String>,
    dest_dir: String,
    conflict_resolution: Option<String>,
    directory_mode: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpTransferResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_transfer(
        &service,
        source_session_id,
        target_session_id,
        paths,
        dest_dir,
        conflict_resolution,
        directory_mode,
    )
    .await
}

#[tauri::command]
pub(crate) async fn sftp_move(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    paths: Vec<String>,
    dest_dir: String,
    conflict_resolution: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<sftp::SftpMoveResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_move(&service, session_id, paths, dest_dir, conflict_resolution).await
}

#[tauri::command]
pub(crate) async fn sftp_pause_transfer(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::TransferTask, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_pause_transfer(&service, task_id).await
}
#[tauri::command]
pub(crate) async fn sftp_resume_transfer(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    workspace_generation: Option<u64>,
) -> Result<sftp::TransferTask, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_resume_transfer(&service, task_id).await
}
#[tauri::command]
pub(crate) async fn sftp_retry_transfer(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    restart: bool,
    workspace_generation: Option<u64>,
) -> Result<sftp::TransferTask, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_retry_transfer(&service, task_id, restart).await
}
#[tauri::command]
pub(crate) async fn sftp_upload_checkpoint(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_upload_checkpoint(&service, task_id).await
}
#[tauri::command]
pub(crate) async fn sftp_resume_upload(
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    size: u64,
    last_modified: Option<u64>,
    digests: Vec<String>,
    restart: bool,
    workspace_generation: Option<u64>,
) -> Result<serde_json::Value, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    sftp::sftp_resume_upload(&service, task_id, size, last_modified, digests, restart).await
}
