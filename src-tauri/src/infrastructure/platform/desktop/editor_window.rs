//! Desktop editor window lifecycle and close coordination.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const EDITOR_WINDOW_LABEL: &str = "editor";
const EDITOR_OPEN_FILE_EVENT: &str = "eizhu-editor-open-file";
const APP_CLOSE_REQUEST_EVENT: &str = "eizhu-app-close-request";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorOpenRequest {
    session_id: String,
    session_type: String,
    path: String,
}

#[derive(Default)]
struct EditorWindowState {
    ready: bool,
    creating: bool,
    app_close_requested: bool,
    close_when_ready: bool,
    pending: Vec<EditorOpenRequest>,
    transition: super::editor_transition::TransitionGate,
}

/// Coordinates requests from the main webview with the lazily-created editor webview.
#[derive(Default)]
pub(crate) struct EditorWindowCoordinator(Mutex<EditorWindowState>);

impl EditorWindowCoordinator {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, EditorWindowState>, String> {
        self.0
            .lock()
            .map_err(|_| "编辑器窗口状态不可用".to_string())
    }

    fn fail_creation(&self) -> Result<bool, String> {
        let mut state = self.lock()?;
        state.transition.cancel();
        state.creating = false;
        state.ready = false;
        state.pending.clear();
        state.app_close_requested = false;
        Ok(std::mem::take(&mut state.close_when_ready))
    }

    fn requeue(&self, requests: Vec<EditorOpenRequest>) {
        if let Ok(mut state) = self.0.lock() {
            let mut pending = requests;
            pending.append(&mut state.pending);
            state.pending = pending;
        }
    }
}

fn emit_editor_requests(
    app: &AppHandle,
    coordinator: &EditorWindowCoordinator,
    requests: Vec<EditorOpenRequest>,
) -> Result<(), String> {
    for (index, request) in requests.iter().enumerate() {
        if let Err(error) =
            app.emit_to(EDITOR_WINDOW_LABEL, EDITOR_OPEN_FILE_EVENT, request.clone())
        {
            coordinator.requeue(requests[index..].to_vec());
            return Err(error.to_string());
        }
    }
    Ok(())
}

fn destroy_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) async fn open_editor_window(
    app: AppHandle,
    coordinator: &EditorWindowCoordinator,
    session_id: String,
    session_type: String,
    path: String,
) -> Result<(), String> {
    if !matches!(session_type.as_str(), "sftp" | "serverDetail") {
        return Err("不支持的编辑器会话类型".to_string());
    }

    let existing = app.get_webview_window(EDITOR_WINDOW_LABEL);
    let (create_window, ready_requests) = {
        let mut state = coordinator.lock()?;
        if state.transition.is_pending() {
            return Err("请先完成数据空间切换确认".into());
        }
        if existing.is_none() && !state.creating {
            state.ready = false;
            state.app_close_requested = false;
            state.close_when_ready = false;
        }
        state.pending.push(EditorOpenRequest {
            session_id,
            session_type,
            path,
        });

        if state.ready && existing.is_some() {
            (false, std::mem::take(&mut state.pending))
        } else if existing.is_none() && !state.creating {
            state.creating = true;
            (true, Vec::new())
        } else {
            (false, Vec::new())
        }
    };

    if create_window {
        let decorations = cfg!(target_os = "macos");
        let app_for_build = app.clone();
        let build = tauri::async_runtime::spawn_blocking(move || {
            WebviewWindowBuilder::new(
                &app_for_build,
                EDITOR_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title("eizhu — 编辑器")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .resizable(true)
            .decorations(decorations)
            .visible(false)
            .center()
            .build()
            .map(|window| {
                let app = app_for_build.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        if let Ok(mut state) = app.state::<EditorWindowCoordinator>().lock() {
                            state.ready = false;
                            state.transition.cancel();
                        }
                    }
                });
            })
            .map_err(|error| error.to_string())
        })
        .await;
        let result = match build {
            Ok(result) => result,
            Err(error) => {
                if coordinator.fail_creation()? {
                    destroy_main_window(&app)?;
                }
                return Err(error.to_string());
            }
        };
        if let Err(error) = result {
            if coordinator.fail_creation()? {
                destroy_main_window(&app)?;
            }
            return Err(error);
        }
    }

    if !ready_requests.is_empty() {
        emit_editor_requests(&app, coordinator, ready_requests)?;
    }

    if let Some(window) = existing {
        let ready = coordinator.lock()?.ready;
        if ready {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    Ok(())
}

/// Routes a main-window close request through the editor so it can protect unsaved files.
pub(crate) fn request_app_close(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: &EditorWindowCoordinator,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("该命令仅供主窗口调用".to_string());
    }

    let (editor, editor_ready, close_when_ready) = {
        let mut state = coordinator.lock()?;
        if state.transition.is_pending() {
            return Err("请先完成数据空间切换确认".into());
        }
        let editor = app.get_webview_window(EDITOR_WINDOW_LABEL);
        match editor {
            Some(editor) if state.ready => {
                if state.app_close_requested {
                    return Ok(());
                }
                state.app_close_requested = true;
                (Some(editor), true, false)
            }
            Some(editor) => {
                // The editor UI has not completed its listener handshake, so
                // it cannot contain user edits that need preserving.
                state.ready = false;
                state.creating = false;
                state.app_close_requested = false;
                state.close_when_ready = false;
                state.pending.clear();
                (Some(editor), false, false)
            }
            None if state.creating => {
                // Window creation is in flight. Keep the main window alive
                // until the editor can be closed too.
                state.close_when_ready = true;
                (None, false, true)
            }
            None => {
                state.ready = false;
                state.app_close_requested = false;
                state.close_when_ready = false;
                (None, false, false)
            }
        }
    };

    if close_when_ready {
        return Ok(());
    }

    if let Some(editor) = editor {
        if editor_ready {
            if let Err(error) = app.emit_to(EDITOR_WINDOW_LABEL, APP_CLOSE_REQUEST_EVENT, ()) {
                if let Ok(mut state) = coordinator.0.lock() {
                    state.app_close_requested = false;
                }
                return Err(error.to_string());
            }
            return Ok(());
        }

        editor.destroy().map_err(|error| error.to_string())?;
    }

    destroy_main_window(&app)
}

/// Completes or cancels an application close after the editor has handled unsaved files.
pub(crate) fn resolve_app_close(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: &EditorWindowCoordinator,
    should_close: bool,
) -> Result<(), String> {
    if window.label() != EDITOR_WINDOW_LABEL {
        return Err("该命令仅供编辑器窗口调用".to_string());
    }
    if !should_close {
        coordinator.lock()?.app_close_requested = false;
        return Ok(());
    }
    coordinator.lock()?.app_close_requested = false;

    window.destroy().map_err(|error| error.to_string())?;
    destroy_main_window(&app)
}

/// Shows the editor's fatal startup page without marking its event bridge ready.
pub(crate) fn editor_window_show(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: &EditorWindowCoordinator,
) -> Result<(), String> {
    if window.label() != EDITOR_WINDOW_LABEL {
        return Err("该命令仅供编辑器窗口调用".to_string());
    }
    let close_when_ready = {
        let mut state = coordinator.lock()?;
        state.ready = false;
        state.creating = false;
        state.pending.clear();
        state.app_close_requested = false;
        std::mem::take(&mut state.close_when_ready)
    };
    if close_when_ready {
        window.destroy().map_err(|error| error.to_string())?;
        return destroy_main_window(&app);
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub(crate) fn editor_window_ready(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: &EditorWindowCoordinator,
) -> Result<(), String> {
    if window.label() != EDITOR_WINDOW_LABEL {
        return Err("该命令仅供编辑器窗口调用".to_string());
    }

    let (requests, close_when_ready) = {
        let mut state = coordinator.lock()?;
        if state.close_when_ready {
            state.ready = false;
            state.creating = false;
            state.app_close_requested = false;
            state.pending.clear();
            state.close_when_ready = false;
            (Vec::new(), true)
        } else {
            state.ready = true;
            state.creating = false;
            (std::mem::take(&mut state.pending), false)
        }
    };

    if close_when_ready {
        window.destroy().map_err(|error| error.to_string())?;
        return destroy_main_window(&app);
    }

    let emit_result = emit_editor_requests(&app, coordinator, requests);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    emit_result
}

/// Ask the existing editor to save/discard/cancel before account IPC changes the space.
pub(crate) async fn request_editor_transition(
    app: AppHandle,
    window: WebviewWindow,
    coordinator: &EditorWindowCoordinator,
) -> Result<bool, String> {
    if window.label() != "main" {
        return Err("该命令仅供主窗口调用".into());
    }
    let Some(editor) = app.get_webview_window(EDITOR_WINDOW_LABEL) else {
        if coordinator.lock()?.creating {
            return Err("编辑器正在初始化，请稍后重试".into());
        }
        return Ok(true);
    };
    let (id, receiver) = {
        let mut state = coordinator.lock()?;
        if !state.ready {
            return Err("编辑器尚未就绪，请稍后重试".into());
        }
        if state.app_close_requested {
            return Err("正在关闭应用，请先完成关闭确认".into());
        }
        state.transition.begin()?
    };
    if let Err(error) = app.emit_to(
        EDITOR_WINDOW_LABEL,
        "eizhu-editor-transition",
        serde_json::json!({"requestId":id}),
    ) {
        coordinator.lock()?.transition.cancel();
        return Err(error.to_string());
    }
    let _ = editor.unminimize();
    let _ = editor.show();
    let _ = editor.set_focus();
    receiver.await.map_err(|_| "编辑器确认已中断".into())
}
pub(crate) fn resolve_editor_transition(
    window: WebviewWindow,
    coordinator: &EditorWindowCoordinator,
    request_id: String,
    accepted: bool,
) -> Result<(), String> {
    if window.label() != EDITOR_WINDOW_LABEL {
        return Err("该命令仅供编辑器窗口调用".into());
    }
    let sender = coordinator.lock()?.transition.take(&request_id)?;
    if accepted {
        if let Err(error) = window.destroy() {
            let _ = sender.send(false);
            return Err(error.to_string());
        }
    }
    let _ = sender.send(accepted);
    Ok(())
}
