//! Main window geometry derived from the startup monitor's work area.

use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};

const INITIAL_WORK_AREA_RATIO: f64 = 0.85;

struct InitialWindowGeometry {
    size: PhysicalSize<u32>,
    min_size: LogicalSize<f64>,
    position: PhysicalPosition<i32>,
}

fn initial_window_geometry(
    work_size: PhysicalSize<u32>,
    work_position: PhysicalPosition<i32>,
    frame_size: PhysicalSize<u32>,
    scale_factor: f64,
) -> Option<InitialWindowGeometry> {
    if work_size.width <= frame_size.width
        || work_size.height <= frame_size.height
        || !scale_factor.is_finite()
        || scale_factor <= 0.0
    {
        return None;
    }

    // 比例作用于整个窗口，包含标题栏和边框，避免外框超出工作区。
    let outer_width = ((f64::from(work_size.width) * INITIAL_WORK_AREA_RATIO).round() as u32)
        .max(frame_size.width + 1);
    let outer_height = ((f64::from(work_size.height) * INITIAL_WORK_AREA_RATIO).round() as u32)
        .max(frame_size.height + 1);
    let size = PhysicalSize::new(
        outer_width - frame_size.width,
        outer_height - frame_size.height,
    );
    let logical_size = size.to_logical::<f64>(scale_factor);

    Some(InitialWindowGeometry {
        size,
        // 保留常规桌面的最小布局尺寸，小屏幕或高缩放时允许进一步缩小。
        min_size: LogicalSize::new(
            900.0_f64.min(logical_size.width),
            600.0_f64.min(logical_size.height),
        ),
        position: PhysicalPosition::new(
            work_position.x + ((work_size.width - outer_width) / 2) as i32,
            work_position.y + ((work_size.height - outer_height) / 2) as i32,
        ),
    })
}

pub(crate) fn configure_main_window(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    super::macos_chrome::install(window);

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let frame_size = PhysicalSize::new(
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    let work_area = monitor.work_area();
    let Some(geometry) = initial_window_geometry(
        work_area.size,
        work_area.position,
        frame_size,
        monitor.scale_factor(),
    ) else {
        return Ok(());
    };

    // 仅在启动 setup 阶段调整，前端刷新和再次聚焦不会覆盖用户手动调整的尺寸。
    window.set_min_size(Some(geometry.min_size))?;
    window.set_size(geometry.size)?;
    window.set_position(geometry.position)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_grows_with_the_available_work_area() {
        let geometry = |width, height| {
            initial_window_geometry(
                PhysicalSize::new(width, height),
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(0, 0),
                1.0,
            )
            .unwrap()
        };
        let laptop = geometry(1366, 728);
        let desktop = geometry(2560, 1400);

        assert!(desktop.size.width > laptop.size.width);
        assert!(desktop.size.height > laptop.size.height);
        assert!(desktop.size.width < 2560);
        assert!(desktop.size.height < 1400);
    }

    #[test]
    fn centers_the_outer_window_inside_an_offset_work_area() {
        let work_size = PhysicalSize::new(1920, 1040);
        let work_position = PhysicalPosition::new(-1920, 40);
        let frame_size = PhysicalSize::new(16, 39);
        let geometry = initial_window_geometry(work_size, work_position, frame_size, 1.0).unwrap();
        let left = geometry.position.x - work_position.x;
        let top = geometry.position.y - work_position.y;
        let right = work_size.width as i32 - left - (geometry.size.width + frame_size.width) as i32;
        let bottom =
            work_size.height as i32 - top - (geometry.size.height + frame_size.height) as i32;

        assert!(left > 0 && top > 0 && right > 0 && bottom > 0);
        assert!((left - right).abs() <= 1);
        assert!((top - bottom).abs() <= 1);
    }

    #[test]
    fn equivalent_scaled_monitors_have_the_same_logical_window_size() {
        let geometry = |width, height, scale| {
            initial_window_geometry(
                PhysicalSize::new(width, height),
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(0, 0),
                scale,
            )
            .unwrap()
        };
        let standard = geometry(1920, 1040, 1.0);
        let retina = geometry(3840, 2080, 2.0);

        assert_eq!(
            standard.size.to_logical::<f64>(1.0),
            retina.size.to_logical::<f64>(2.0)
        );
        assert_eq!(standard.min_size, retina.min_size);
    }

    #[test]
    fn minimum_size_never_forces_small_or_scaled_windows_outside_the_screen() {
        for (width, height, scale) in [(800, 560, 1.0), (1920, 1040, 2.0), (2560, 1400, 1.5)] {
            let geometry = initial_window_geometry(
                PhysicalSize::new(width, height),
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(16, 39),
                scale,
            )
            .unwrap();
            let logical = geometry.size.to_logical::<f64>(scale);

            assert!(geometry.min_size.width <= logical.width);
            assert!(geometry.min_size.height <= logical.height);
            assert!(geometry.size.width + 16 < width);
            assert!(geometry.size.height + 39 < height);
        }
    }

    #[test]
    fn invalid_monitor_geometry_keeps_the_platform_default() {
        for (width, height, scale) in [(0, 0, 1.0), (1920, 1040, 0.0), (1920, 1040, f64::NAN)] {
            assert!(initial_window_geometry(
                PhysicalSize::new(width, height),
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(0, 0),
                scale,
            )
            .is_none());
        }
    }
}
