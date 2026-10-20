//! Native AppKit buttons aligned in webview coordinates, independent of SDK metrics.

use objc2::{msg_send, runtime::AnyObject, sel};
use objc2_foundation::{NSPoint, NSRect};
use tauri::{WebviewWindow, WindowEvent};

// Read by scripts/verify-macos-window-chrome.swift as the production contract.
const TOOLBAR_HEIGHT: f64 = 64.0;
const FIRST_BUTTON_CENTER_X: f64 = 31.0;
const BUTTON_SPACING: f64 = 23.0;

pub(super) fn install(window: &WebviewWindow) {
    update(window);
    let tracked = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
                | WindowEvent::Focused(true)
        ) {
            update(&tracked);
        }
    });
}

fn update(window: &WebviewWindow) {
    let target = window.clone();
    let _ = window.with_webview(move |webview| {
        // Fullscreen chrome belongs to AppKit; resize on exit restores our layout.
        if target.is_fullscreen().unwrap_or(false) {
            return;
        }
        let pointer = webview.ns_window();
        let viewport = webview.inner();
        if pointer.is_null() || viewport.is_null() {
            return;
        }
        // SAFETY: with_webview runs on the main thread and provides the live
        // NSWindow/WKWebView handles. Every optional native subview is checked.
        unsafe {
            align_buttons(
                &*pointer.cast::<AnyObject>(),
                &*viewport.cast::<AnyObject>(),
            )
        };
    });
}

unsafe fn align_buttons(window: &AnyObject, content: &AnyObject) {
    let close: *mut AnyObject = msg_send![window, standardWindowButton: 0usize];
    let Some(close) = close.as_ref() else {
        return;
    };
    let parent: *mut AnyObject = msg_send![close, superview];
    let Some(parent) = parent.as_ref() else {
        return;
    };
    let container: *mut AnyObject = msg_send![parent, superview];
    let Some(container) = container.as_ref() else {
        return;
    };

    // macOS 26 can inherit compact control metrics from the window host. Ask
    // AppKit for its standard (larger) titlebar controls before reading their
    // native frames. Older macOS versions do not implement this selector.
    let content_view: *mut AnyObject = msg_send![window, contentView];
    let Some(content_view) = content_view.as_ref() else {
        return;
    };
    let metrics_view: *mut AnyObject = msg_send![content_view, superview];
    let Some(metrics_view) = metrics_view.as_ref() else {
        return;
    };
    let supports_control_metrics: bool = msg_send![
        metrics_view,
        respondsToSelector: sel!(setPrefersCompactControlSizeMetrics:)
    ];
    if supports_control_metrics {
        let _: () = msg_send![metrics_view, setPrefersCompactControlSizeMetrics: false];
        let _: () = msg_send![metrics_view, layoutSubtreeIfNeeded];
    }

    let window_frame: NSRect = msg_send![window, frame];
    let mut frame: NSRect = msg_send![container, frame];
    frame.size.height = TOOLBAR_HEIGHT;
    frame.origin.y = window_frame.size.height - TOOLBAR_HEIGHT;
    let _: () = msg_send![container, setFrame: frame];

    let content_bounds: NSRect = msg_send![content, bounds];
    let flipped: bool = msg_send![content, isFlipped];
    let center_y = content_bounds.origin.y
        + if flipped {
            TOOLBAR_HEIGHT / 2.0
        } else {
            content_bounds.size.height - TOOLBAR_HEIGHT / 2.0
        };
    for index in 0..3usize {
        let button: *mut AnyObject = msg_send![window, standardWindowButton: index];
        let Some(button) = button.as_ref() else {
            continue;
        };
        let parent: *mut AnyObject = msg_send![button, superview];
        let Some(parent) = parent.as_ref() else {
            continue;
        };
        let mut frame: NSRect = msg_send![button, frame];
        let center = NSPoint::new(
            FIRST_BUTTON_CENTER_X + index as f64 * BUTTON_SPACING,
            center_y,
        );
        let center: NSPoint = msg_send![parent, convertPoint: center, fromView: content];
        // Keep AppKit's native button dimensions. Resizing these private
        // titlebar controls can stretch their glyphs into horizontal ovals on
        // compact macOS metrics; centering the original frame is sufficient.
        frame.origin.x = center.x - frame.size.width / 2.0;
        frame.origin.y = center.y - frame.size.height / 2.0;
        let _: () = msg_send![button, setFrame: frame];
        let _: () = msg_send![button, setNeedsDisplay: true];
    }
}
