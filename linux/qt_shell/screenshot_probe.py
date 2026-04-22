from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Callable

from PySide6.QtGui import QCursor, QGuiApplication, QPixmap

from .capture import (
    _capture_via_flameshot_full,
    _capture_via_flameshot_gui_path,
    _capture_via_flameshot_gui_raw,
    _capture_via_gnome_shell_screenshot,
    _capture_via_gnome_screenshot_tool,
    _capture_via_grim,
    _capture_via_portal_screenshot,
    _describe_pixmap,
    _grab_screen_with_fallbacks,
)
from .logging_utils import LOG_LEVEL_INFO, get_shell_log_path, log_event


ProbeFn = Callable[[], tuple[QPixmap | None, list[str]]]


def _probe_output_directory() -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    root = Path(__file__).resolve().parents[1] / "data" / "screenshot-probe" / stamp
    root.mkdir(parents=True, exist_ok=True)
    return root


def _save_pixmap(pixmap: QPixmap | None, path: Path) -> bool:
    if pixmap is None or pixmap.isNull():
        return False
    return pixmap.save(str(path), "PNG")


def _screen_probe() -> tuple[QPixmap | None, list[str]]:
    cursor_position = QCursor.pos()
    screen = QGuiApplication.screenAt(cursor_position) or QGuiApplication.primaryScreen()
    if screen is None:
        return None, ["qt_grab=no_screen"]
    return _grab_screen_with_fallbacks(screen)


def _build_variants() -> list[tuple[str, ProbeFn]]:
    return [
        ("qt_grab", _screen_probe),
        ("gnome_screenshot_tool", _capture_via_gnome_screenshot_tool),
        ("flameshot_full", _capture_via_flameshot_full),
        ("flameshot_gui_raw", _capture_via_flameshot_gui_raw),
        ("flameshot_gui_path", _capture_via_flameshot_gui_path),
        ("portal_noninteractive", lambda: _capture_via_portal_screenshot(interactive=False)),
        ("portal_interactive", lambda: _capture_via_portal_screenshot(interactive=True)),
        ("gnome_shell_private", _capture_via_gnome_shell_screenshot),
        ("grim", _capture_via_grim),
    ]


def main() -> int:
    app = QGuiApplication.instance() or QGuiApplication([])
    output_dir = _probe_output_directory()
    results: list[dict] = []

    environment = {
        "XDG_SESSION_TYPE": os.environ.get("XDG_SESSION_TYPE", ""),
        "XDG_CURRENT_DESKTOP": os.environ.get("XDG_CURRENT_DESKTOP", ""),
        "QT_QPA_PLATFORM": os.environ.get("QT_QPA_PLATFORM", ""),
        "QT_QPA_PLATFORMTHEME": os.environ.get("QT_QPA_PLATFORMTHEME", ""),
        "LOG_LEVEL": os.environ.get("LOG_LEVEL", ""),
    }

    screens = [
        {
            "name": screen.name(),
            "geometry": {
                "x": screen.geometry().x(),
                "y": screen.geometry().y(),
                "width": screen.geometry().width(),
                "height": screen.geometry().height(),
            },
            "devicePixelRatio": screen.devicePixelRatio(),
        }
        for screen in QGuiApplication.screens()
    ]

    for name, probe in _build_variants():
        try:
            pixmap, diagnostics = probe()
            image_path = output_dir / f"{name}.png"
            saved = _save_pixmap(pixmap, image_path)
            result = {
                "name": name,
                "saved": saved,
                "file": str(image_path) if saved else None,
                "pixmap": _describe_pixmap(pixmap) if pixmap is not None else "none",
                "diagnostics": diagnostics,
            }
        except Exception as exc:
            result = {
                "name": name,
                "saved": False,
                "file": None,
                "pixmap": "error",
                "diagnostics": [f"exception={exc}"],
            }
        results.append(result)
        log_event(LOG_LEVEL_INFO, "screenshot_probe.variant", **result)

    summary = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "outputDir": str(output_dir),
        "logFile": str(get_shell_log_path()),
        "environment": environment,
        "screens": screens,
        "results": results,
    }
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    # Keep the app object alive long enough for platform plugins to settle.
    app.processEvents()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
