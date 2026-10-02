//! Desktop-only paths, dialogs, logs, migration and drag-out capabilities.

mod dialogs;
mod drag_out;
mod editor_transition;
mod editor_window;
mod error;
mod logs;
mod paths;
mod settings_migration;

pub(crate) use dialogs::save_blob;
pub(crate) use drag_out::{materialize_drag, sweep_stale_drag_temps, DragOutFiles};
pub(crate) use error::PlatformError;
pub(crate) use logs::{append_frontend_log, clear_app_log, read_app_log, AppLogSnapshot};
pub(crate) use paths::{is_test_build, user_data_dir};
pub(crate) use settings_migration::{mark_migrated, read_unmigrated};

pub(crate) use editor_window::{
    editor_window_ready, editor_window_show, open_editor_window, request_app_close,
    request_editor_transition, resolve_app_close, resolve_editor_transition,
    EditorWindowCoordinator,
};
