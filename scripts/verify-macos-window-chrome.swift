import AppKit
import Foundation
import WebKit

// Native geometry only: never show or activate a window. Read the same constants
// as the production AppKit adapter; do not infer native metrics from a Tauri inset.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = try String(contentsOf: root.appendingPathComponent("src-tauri/src/infrastructure/platform/desktop/macos_chrome.rs"), encoding: .utf8)
let css = try String(contentsOf: root.appendingPathComponent("web/src/styles/desktop-shell.css"), encoding: .utf8)

func number(_ pattern: String, in text: String) -> Double {
    let expression = try! NSRegularExpression(pattern: pattern)
    let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))!
    return Double(text[Range(match.range(at: 1), in: text)!])!
}
func native(_ name: String) -> Double { number("const " + name + #": f64 = ([0-9.]+);"#, in: source) }
func cssPixels(_ name: String) -> Double { number(NSRegularExpression.escapedPattern(for: name) + #":\s*([0-9.]+)px"#, in: css) }

func require(_ condition: Bool, _ message: String) {
    if !condition {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

let targetCenter = cssPixels("--shell-top-height") / 2
let reservedWidth = cssPixels("--shell-mac-controls-space")
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)

let height = native("TOOLBAR_HEIGHT")
let buttonSize = native("BUTTON_SIZE")
require(height / 2 == targetCenter, "Rust and CSS toolbar heights must agree")

// Compact/legacy metrics reproduce the 12pt buttons and different baseline that
// the earlier single-SDK check missed. Every pass also verifies idempotence.
for compact in [false, true] {
    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 900, height: 600),
        styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
        backing: .buffered,
        defer: false
    )
    window.isReleasedWhenClosed = false
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    if #available(macOS 26.0, *) {
        window.contentView?.superview?.prefersCompactControlSizeMetrics = compact
        window.contentView?.superview?.layoutSubtreeIfNeeded()
    }
    let viewport = WKWebView(frame: .zero)
    window.contentView!.addSubview(viewport)
    let buttons = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].map { window.standardWindowButton($0)! }
    if compact {
        for (index, button) in buttons.enumerated() {
            button.frame = NSRect(x: 7 + index * 20, y: 3, width: 12, height: 12)
        }
    }
    for size in [NSSize(width: 900, height: 600), NSSize(width: 1440, height: 900), NSSize(width: 1920, height: 1080)] {
        window.setContentSize(size)
        let viewportBounds = window.contentView!.bounds
        viewport.frame = NSRect(x: 0, y: 0, width: viewportBounds.width, height: viewportBounds.height - (compact ? 4 : 0))
        let drawingBounds = buttons.map { $0.bounds }
        for _ in 0..<2 {
            let titlebar = buttons[0].superview!.superview!
            var frame = titlebar.frame
            frame.size.height = height
            frame.origin.y = window.frame.height - height
            titlebar.frame = frame
            let content = viewport
            for (index, button) in buttons.enumerated() {
                let bounds = button.bounds
                let point = NSPoint(x: native("FIRST_BUTTON_CENTER_X") + Double(index) * native("BUTTON_SPACING"), y: content.isFlipped ? content.bounds.minY + height / 2 : content.bounds.maxY - height / 2)
                let center = button.superview!.convert(point, from: content)
                button.frame = NSRect(x: center.x - buttonSize / 2, y: center.y - buttonSize / 2, width: buttonSize, height: buttonSize)
                button.bounds = bounds
                button.needsDisplay = true
            }
            let rects = buttons.map { content.convert($0.bounds, from: $0) }
            let centers = rects.map { content.isFlipped ? $0.midY - content.bounds.minY : content.bounds.maxY - $0.midY }
            for center in centers {
                require(abs(center - targetCenter) <= 0.5, "native center \(center) does not match CSS center \(targetCenter)")
            }
            require(rects.allSatisfy { abs($0.width - buttonSize) < 0.1 && abs($0.height - buttonSize) < 0.1 }, "native hit targets must be \(buttonSize)pt")
            require(buttons.enumerated().allSatisfy { abs($0.element.bounds.width - drawingBounds[$0.offset].width) < 0.001 && abs($0.element.bounds.height - drawingBounds[$0.offset].height) < 0.001 }, "drawing bounds must not compound across passes")
            require(rects.last!.maxX + 8 <= reservedWidth, "native buttons overlap toolbar reservation")
            require(!window.isVisible, "verification window must remain invisible")
        }
        print("PASS compact=\(compact), \(Int(size.width))×\(Int(size.height)): native centers=\(targetCenter)pt, hit targets=\(buttonSize)pt")
    }
    window.close()
}
