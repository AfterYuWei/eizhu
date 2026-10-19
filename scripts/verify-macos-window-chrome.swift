import AppKit
import Foundation

// Read the production config and CSS; never show or activate a window.
// Mirrors Tao 0.35.3 inset_traffic_lights, pinned by src-tauri/Cargo.lock:
// https://github.com/tauri-apps/tao/blob/5a14e624c81b7a799728129417e9218be25f17d9/src/platform_impl/macos/view.rs
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let configData = try Data(contentsOf: root.appendingPathComponent("src-tauri/tauri.macos.conf.json"))
let config = try JSONSerialization.jsonObject(with: configData) as! [String: Any]
let windows = (config["app"] as! [String: Any])["windows"] as! [[String: Any]]
let position = windows.first(where: { $0["label"] as? String == "main" })!["trafficLightPosition"] as! [String: Double]
let css = try String(contentsOf: root.appendingPathComponent("web/src/styles/desktop-shell.css"), encoding: .utf8)

func cssPixels(_ name: String) -> Double {
    let expression = try! NSRegularExpression(pattern: NSRegularExpression.escapedPattern(for: name) + #":\s*([0-9.]+)px"#)
    let match = expression.firstMatch(in: css, range: NSRange(css.startIndex..., in: css))!
    return Double(css[Range(match.range(at: 1), in: css)!])!
}

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

for size in [NSSize(width: 900, height: 600), NSSize(width: 1440, height: 900), NSSize(width: 1920, height: 1080)] {
    let window = NSWindow(
        contentRect: NSRect(origin: .zero, size: size),
        styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
        backing: .buffered,
        defer: false
    )
    window.isReleasedWhenClosed = false
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    let buttons = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].map { window.standardWindowButton($0)! }
    let titlebar = buttons[0].superview!.superview!
    let spacing = buttons[1].frame.minX - buttons[0].frame.minX
    var frame = titlebar.frame
    frame.size.height = buttons[0].frame.height + position["y"]!
    frame.origin.y = window.frame.height - frame.height
    titlebar.frame = frame
    for (index, button) in buttons.enumerated() {
        button.setFrameOrigin(NSPoint(x: position["x"]! + Double(index) * spacing, y: button.frame.minY))
    }

    let content = window.contentView!
    let rects = buttons.map { content.convert($0.bounds, from: $0) }
    let centers = rects.map { content.bounds.maxY - $0.midY }
    for center in centers {
        require(abs(center - targetCenter) <= 0.5, "native center \(center) does not match CSS center \(targetCenter)")
    }
    require(rects.last!.maxX + 8 <= reservedWidth, "native buttons overlap toolbar reservation")
    require(!window.isVisible, "verification window must remain invisible")
    print("PASS \(Int(size.width))×\(Int(size.height)): centers=\(centers), right=\(rects.last!.maxX), reserved=\(reservedWidth), scale=\(window.backingScaleFactor)")
    window.close()
}
