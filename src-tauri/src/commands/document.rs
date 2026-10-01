use tauri::{AppHandle, State};
use tokio::io::AsyncReadExt;

use crate::{
    error::CommandError,
    infrastructure::platform::document_gateway::{DocumentDescriptor, DocumentGateway},
    sftp::{self, SftpUploadResponse},
};

#[tauri::command]
pub(crate) async fn document_pick(
    app: AppHandle,
    gateway: State<'_, DocumentGateway>,
    multiple: Option<bool>,
    mime_types: Option<Vec<String>>,
) -> Result<Vec<DocumentDescriptor>, CommandError> {
    gateway.pick(
        &app,
        multiple.unwrap_or(false),
        mime_types.unwrap_or_default(),
    )
}

#[tauri::command]
pub(crate) fn document_release(
    gateway: State<'_, DocumentGateway>,
    reference: String,
) -> Result<(), CommandError> {
    gateway.release(&reference)
}

#[tauri::command]
pub(crate) async fn document_read_text(
    gateway: State<'_, DocumentGateway>,
    reference: String,
    max_bytes: Option<u64>,
) -> Result<String, CommandError> {
    let (path, _, size) = gateway.resolve(&reference)?;
    let limit = max_bytes.unwrap_or(1024 * 1024).min(4 * 1024 * 1024);
    if size > limit {
        return Err(CommandError::new(
            "DOCUMENT_TOO_LARGE",
            "selected document is too large",
        ));
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| CommandError::new("DOCUMENT_IO", error.to_string()))?;
    String::from_utf8(bytes)
        .map_err(|_| CommandError::new("DOCUMENT_ENCODING", "selected document is not UTF-8"))
}

#[tauri::command]
pub(crate) async fn document_export_text(
    app: AppHandle,
    gateway: State<'_, DocumentGateway>,
    content: String,
    suggested_name: String,
    mime_type: Option<String>,
) -> Result<Option<String>, CommandError> {
    if content.len() > 4 * 1024 * 1024 {
        return Err(CommandError::new(
            "DOCUMENT_TOO_LARGE",
            "export content is too large",
        ));
    }
    let path = gateway.write_export(&suggested_name, content.as_bytes())?;
    let result = gateway.export_file(
        &app,
        &path,
        suggested_name,
        mime_type.unwrap_or_else(|| "text/plain".into()),
    );
    let _ = tokio::fs::remove_file(path).await;
    result
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sftp_upload_document(
    gateway: State<'_, DocumentGateway>,
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    session_id: String,
    reference: String,
    dest_dir: String,
    overwrite: Option<bool>,
    conflict_resolution: Option<String>,
    workspace_generation: Option<u64>,
) -> Result<SftpUploadResponse, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    let (path, name, size) = gateway.resolve(&reference)?;
    let result = async {
        let resolution = conflict_resolution.unwrap_or_else(|| {
            if overwrite.unwrap_or(false) {
                "overwrite".into()
            } else {
                "ask".into()
            }
        });
        let Some(begin) = sftp::sftp_upload_begin_with_resolution(
            &service,
            session_id,
            name,
            dest_dir,
            &resolution,
            size,
        )
        .await?
        else {
            return Ok(SftpUploadResponse { tasks: Vec::new() });
        };
        let upload_id = begin.upload_id.clone();
        let transfer = async {
            let mut file = tokio::fs::File::open(path)
                .await
                .map_err(|error| CommandError::new("DOCUMENT_IO", error.to_string()))?;
            let mut buffer = vec![0_u8; 256 * 1024];
            loop {
                let count = file
                    .read(&mut buffer)
                    .await
                    .map_err(|error| CommandError::new("DOCUMENT_IO", error.to_string()))?;
                if count == 0 {
                    break;
                }
                sftp::upload_chunk(&service, &upload_id, &buffer[..count]).await?;
            }
            sftp::sftp_upload_finish(&service, upload_id.clone()).await
        }
        .await;
        if transfer.is_err() {
            let _ = sftp::sftp_upload_abort(&service, upload_id).await;
        }
        transfer
    }
    .await;
    // PATH_EXISTS with `ask` is an intermediate decision point. Keep the
    // staged reference alive so the same document can be retried with the
    // user's overwrite/rename/skip choice; every terminal outcome releases it.
    let awaiting_conflict_resolution = result
        .as_ref()
        .is_err_and(|error| error.code == "PATH_EXISTS");
    if !awaiting_conflict_resolution {
        let _ = gateway.release(&reference);
    }
    result
}

#[tauri::command]
pub(crate) async fn sftp_export_download(
    app: AppHandle,
    gateway: State<'_, DocumentGateway>,
    service_workspace: State<'_, crate::app::WorkspaceManager>,
    task_id: String,
    workspace_generation: Option<u64>,
) -> Result<Option<String>, CommandError> {
    let service = service_workspace
        .current(workspace_generation)?
        .sftp
        .clone();
    let (path, name) = sftp::sftp_download_artifact(&service, &task_id).await?;
    let result = gateway.export_file(&app, &path, name, "application/octet-stream".into());
    let _ = sftp::sftp_download_close(&service, task_id).await;
    result
}
