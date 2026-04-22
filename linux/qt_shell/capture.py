from __future__ import annotations

from dataclasses import dataclass
import base64
import os
from pathlib import Path
import re
import select
import subprocess
import tempfile
import time
from urllib.parse import urlparse, unquote
import shutil

from PySide6.QtCore import QBuffer, QIODevice, Qt
from PySide6.QtGui import QCursor, QGuiApplication, QPixmap

from .logging_utils import LOG_LEVEL_DEBUG, LOG_LEVEL_ERRORS, LOG_LEVEL_INFO, get_shell_log_path, log_event


MAX_SCREENSHOT_EDGE = 2000
JPEG_QUALITY = 82
_OBJECT_PATH_PATTERN = re.compile(r"objectpath '([^']+)'")
_RESPONSE_CODE_PATTERN = re.compile(r"uint32\s+(\d+)")
_URI_PATTERN = re.compile(r'variant\s+string "([^"]+)"')
PORTAL_RESPONSE_TIMEOUT_SECONDS = 8
PRIMARY_GNOME_WAYLAND_TOOL = "gnome-screenshot"


@dataclass
class ScreenshotCaptureResult:
    data_url: str
    summary: str
    width: int
    height: int


def has_gnome_screenshot() -> bool:
    return shutil.which(PRIMARY_GNOME_WAYLAND_TOOL) is not None


def _build_tool_subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in [
        "GTK_PATH",
        "GIO_MODULE_DIR",
        "GI_TYPELIB_PATH",
        "GDK_PIXBUF_MODULEDIR",
        "GDK_PIXBUF_MODULE_FILE",
        "LD_PRELOAD",
        "PYTHONPATH",
    ]:
        env.pop(key, None)

    xdg_data_dirs = env.get("XDG_DATA_DIRS", "")
    if xdg_data_dirs:
        filtered_parts = [
            part for part in xdg_data_dirs.split(":")
            if part and "/snap/" not in part and not part.startswith("/var/lib/snapd/")
        ]
        env["XDG_DATA_DIRS"] = ":".join(filtered_parts)

    return env


def capture_current_screen_as_data_url() -> ScreenshotCaptureResult:
    cursor_position = QCursor.pos()
    target_screen = QGuiApplication.screenAt(cursor_position)
    if target_screen is None:
        target_screen = QGuiApplication.primaryScreen()

    candidate_screens = []
    if target_screen is not None:
        candidate_screens.append(target_screen)
    primary_screen = QGuiApplication.primaryScreen()
    if primary_screen is not None and primary_screen not in candidate_screens:
        candidate_screens.append(primary_screen)
    for screen in QGuiApplication.screens():
        if screen not in candidate_screens:
            candidate_screens.append(screen)

    if not candidate_screens:
        log_event(LOG_LEVEL_ERRORS, "capture.no_screens")
        raise RuntimeError(f"no screen is available for capture; see {get_shell_log_path()}")

    screenshot_pixmap = None
    used_screen = None
    diagnostics: list[str] = []
    session_type = (os.environ.get("XDG_SESSION_TYPE", "") or "").strip().lower()
    desktop = (os.environ.get("XDG_CURRENT_DESKTOP", "") or "").strip().upper()
    if session_type == "wayland":
        if "GNOME" in desktop and not has_gnome_screenshot():
            log_event(
                LOG_LEVEL_ERRORS,
                "capture.missing_primary_backend",
                session_type=session_type,
                desktop=desktop,
                expected_backend=PRIMARY_GNOME_WAYLAND_TOOL,
            )
            raise RuntimeError(
                "gnome-screenshot is required for reliable screen capture on GNOME Wayland; "
                f"details saved to {get_shell_log_path()}"
            )

        wayland_backends = []
        if "GNOME" in desktop and has_gnome_screenshot():
            wayland_backends.append(_capture_via_gnome_screenshot_tool)
        # Keep the remaining paths for debugging and non-GNOME environments.
        # On this GNOME Wayland setup they were tested and did not produce a usable image:
        # - Qt grabWindow(): null pixmaps on Wayland
        # - Flameshot: timeout or "Unable to capture screen"
        # - Portal screenshot: returns response_code=1 in current environment
        # - org.gnome.Shell.Screenshot: AccessDenied
        # - grim: GNOME/Mutter lacks wlr-screencopy support
        if "GNOME" not in desktop:
            if shutil.which("flameshot"):
                wayland_backends.append(_capture_via_flameshot_full)
            wayland_backends.append(_capture_via_portal_screenshot)
            wayland_backends.append(_capture_via_gnome_shell_screenshot)
            if shutil.which("grim"):
                wayland_backends.append(_capture_via_grim)

        for backend in wayland_backends:
            screenshot_pixmap, backend_diagnostics = backend()
            diagnostics.extend(backend_diagnostics)
            if screenshot_pixmap is not None and not screenshot_pixmap.isNull():
                used_screen = target_screen or primary_screen or candidate_screens[0]
                break

        if screenshot_pixmap is None or screenshot_pixmap.isNull() or used_screen is None:
            log_event(
                LOG_LEVEL_ERRORS,
                "capture.failed",
                session_type=session_type,
                diagnostics=diagnostics,
                candidate_screens=[screen.name() for screen in candidate_screens],
            )
            raise RuntimeError(
                f"screen capture returned an empty image; details saved to {get_shell_log_path()}"
            )
    else:
        for screen in candidate_screens:
            screenshot_pixmap, attempt_diagnostics = _grab_screen_with_fallbacks(screen)
            diagnostics.extend(attempt_diagnostics)
            if screenshot_pixmap is not None and not screenshot_pixmap.isNull():
                used_screen = screen
                break

        if screenshot_pixmap is None or screenshot_pixmap.isNull() or used_screen is None:
            screenshot_pixmap, fallback_diagnostics = _capture_via_system_fallbacks()
            diagnostics.extend(fallback_diagnostics)
            if screenshot_pixmap is None or screenshot_pixmap.isNull():
                log_event(
                    LOG_LEVEL_ERRORS,
                    "capture.failed",
                    session_type=session_type,
                    diagnostics=diagnostics,
                    candidate_screens=[screen.name() for screen in candidate_screens],
                )
                raise RuntimeError(
                    f"screen capture returned an empty image; details saved to {get_shell_log_path()}"
                )
            used_screen = target_screen or primary_screen or candidate_screens[0]

    scaled_pixmap = scale_pixmap(screenshot_pixmap, MAX_SCREENSHOT_EDGE)

    image_buffer = QBuffer()
    image_buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    scaled_pixmap.save(image_buffer, "JPEG", JPEG_QUALITY)

    image_base64 = base64.b64encode(bytes(image_buffer.data())).decode("ascii")
    screenshot_data_url = f"data:image/jpeg;base64,{image_base64}"
    screenshot_summary = (
        f"{used_screen.name()} · "
        f"{scaled_pixmap.width()}x{scaled_pixmap.height()} px"
    )
    log_event(
        LOG_LEVEL_INFO,
        "capture.succeeded",
        summary=screenshot_summary,
        session_type=session_type,
        diagnostics=diagnostics,
    )
    return ScreenshotCaptureResult(
        data_url=screenshot_data_url,
        summary=screenshot_summary,
        width=scaled_pixmap.width(),
        height=scaled_pixmap.height(),
    )


def _grab_screen_with_fallbacks(screen) -> QPixmap | None:
    diagnostics = [
        (
            f"screen={screen.name()} "
            f"geometry={_format_geometry(screen.geometry())} "
            f"dpr={screen.devicePixelRatio():.2f}"
        )
    ]
    direct_pixmap = screen.grabWindow(0)
    diagnostics.append(f"grabWindow(0)={_describe_pixmap(direct_pixmap)}")
    if not direct_pixmap.isNull():
        return direct_pixmap, diagnostics

    geometry = screen.geometry()
    geometry_pixmap = screen.grabWindow(
        0,
        geometry.x(),
        geometry.y(),
        geometry.width(),
        geometry.height(),
    )
    diagnostics.append(
        "grabWindow(0, x, y, w, h)="
        f"{_describe_pixmap(geometry_pixmap)}"
    )
    if not geometry_pixmap.isNull():
        return geometry_pixmap, diagnostics

    local_geometry_pixmap = screen.grabWindow(
        0,
        0,
        0,
        geometry.width(),
        geometry.height(),
    )
    diagnostics.append(
        "grabWindow(0, 0, 0, w, h)="
        f"{_describe_pixmap(local_geometry_pixmap)}"
    )
    if not local_geometry_pixmap.isNull():
        return local_geometry_pixmap, diagnostics

    return None, diagnostics


def _capture_via_system_fallbacks() -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []

    gnome_tool_pixmap, gnome_tool_diagnostics = _capture_via_gnome_screenshot_tool()
    diagnostics.extend(gnome_tool_diagnostics)
    if gnome_tool_pixmap is not None and not gnome_tool_pixmap.isNull():
        return gnome_tool_pixmap, diagnostics

    flameshot_pixmap, flameshot_diagnostics = _capture_via_flameshot_full()
    diagnostics.extend(flameshot_diagnostics)
    if flameshot_pixmap is not None and not flameshot_pixmap.isNull():
        return flameshot_pixmap, diagnostics

    gnome_screenshot_pixmap, gnome_diagnostics = _capture_via_gnome_shell_screenshot()
    diagnostics.extend(gnome_diagnostics)
    if gnome_screenshot_pixmap is not None and not gnome_screenshot_pixmap.isNull():
        return gnome_screenshot_pixmap, diagnostics

    portal_screenshot_pixmap, portal_diagnostics = _capture_via_portal_screenshot()
    diagnostics.extend(portal_diagnostics)
    if portal_screenshot_pixmap is not None and not portal_screenshot_pixmap.isNull():
        return portal_screenshot_pixmap, diagnostics

    return None, diagnostics


def _capture_via_gnome_screenshot_tool() -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []
    if not has_gnome_screenshot():
        diagnostics.append("gnome_screenshot_tool=missing")
        return None, diagnostics

    with tempfile.NamedTemporaryFile(prefix="domovik-qt-capture-", suffix=".png", delete=False) as handle:
        temporary_path = Path(handle.name)

    try:
        process = subprocess.run(
            ["gnome-screenshot", "-f", str(temporary_path)],
            capture_output=True,
            text=True,
            check=False,
            timeout=12,
            env=_build_tool_subprocess_env(),
        )
    except Exception as exc:
        diagnostics.append(f"gnome_screenshot_tool=error:{exc}")
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    stdout_text = (process.stdout or "").strip()
    stderr_text = (process.stderr or "").strip()
    diagnostics.append(
        "gnome_screenshot_tool="
        f"rc={process.returncode}"
        + (f" stdout={stdout_text}" if stdout_text else "")
        + (f" stderr={stderr_text}" if stderr_text else "")
    )
    if process.returncode != 0 or not temporary_path.exists():
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    pixmap = QPixmap(str(temporary_path))
    diagnostics.append(f"gnome_screenshot_tool_file={temporary_path} pixmap={_describe_pixmap(pixmap)}")
    temporary_path.unlink(missing_ok=True)
    if pixmap.isNull():
        return None, diagnostics
    return pixmap, diagnostics


def _capture_via_flameshot_full() -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []
    if not shutil.which("flameshot"):
        diagnostics.append("flameshot=missing")
        return None, diagnostics
    # Retained as an experimental fallback. On this GNOME Wayland system it timed out.

    try:
        process = subprocess.run(
            ["flameshot", "full", "--raw"],
            capture_output=True,
            check=False,
            timeout=15,
            env=_build_tool_subprocess_env(),
        )
    except Exception as exc:
        diagnostics.append(f"flameshot=error:{exc}")
        return None, diagnostics

    stderr_text = (process.stderr or b"").decode("utf-8", errors="ignore").strip()
    diagnostics.append(
        "flameshot="
        f"rc={process.returncode}"
        + (f" bytes={len(process.stdout or b'')}" if process.stdout is not None else "")
        + (f" stderr={stderr_text}" if stderr_text else "")
    )
    if process.returncode != 0 or not process.stdout:
        return None, diagnostics

    pixmap = QPixmap()
    pixmap.loadFromData(process.stdout, "PNG")
    diagnostics.append(f"flameshot_pixmap={_describe_pixmap(pixmap)}")
    if pixmap.isNull():
        return None, diagnostics
    return pixmap, diagnostics


def _capture_via_flameshot_gui_raw() -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []
    if not shutil.which("flameshot"):
        diagnostics.append("flameshot_gui_raw=missing")
        return None, diagnostics
    # Retained for probe/debugging. On this GNOME Wayland system Flameshot reported
    # "Unable to capture screen" and returned empty output.

    try:
        process = subprocess.run(
            ["flameshot", "gui", "--accept-on-select", "--raw"],
            capture_output=True,
            check=False,
            timeout=30,
            env=_build_tool_subprocess_env(),
        )
    except Exception as exc:
        diagnostics.append(f"flameshot_gui_raw=error:{exc}")
        return None, diagnostics

    stderr_text = (process.stderr or b"").decode("utf-8", errors="ignore").strip()
    diagnostics.append(
        "flameshot_gui_raw="
        f"rc={process.returncode}"
        + (f" bytes={len(process.stdout or b'')}" if process.stdout is not None else "")
        + (f" stderr={stderr_text}" if stderr_text else "")
    )
    if process.returncode != 0 or not process.stdout:
        return None, diagnostics

    pixmap = QPixmap()
    pixmap.loadFromData(process.stdout, "PNG")
    diagnostics.append(f"flameshot_gui_raw_pixmap={_describe_pixmap(pixmap)}")
    if pixmap.isNull():
        return None, diagnostics
    return pixmap, diagnostics


def _capture_via_flameshot_gui_path() -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []
    if not shutil.which("flameshot"):
        diagnostics.append("flameshot_gui_path=missing")
        return None, diagnostics
    # Retained for probe/debugging. On this GNOME Wayland system Flameshot reported
    # "Unable to capture screen" and produced a null pixmap.

    with tempfile.NamedTemporaryFile(prefix="domovik-qt-capture-", suffix=".png", delete=False) as handle:
        temporary_path = Path(handle.name)

    try:
        process = subprocess.run(
            ["flameshot", "gui", "--accept-on-select", "--path", str(temporary_path)],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
            env=_build_tool_subprocess_env(),
        )
    except Exception as exc:
        diagnostics.append(f"flameshot_gui_path=error:{exc}")
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    stdout_text = (process.stdout or "").strip()
    stderr_text = (process.stderr or "").strip()
    diagnostics.append(
        "flameshot_gui_path="
        f"rc={process.returncode}"
        + (f" stdout={stdout_text}" if stdout_text else "")
        + (f" stderr={stderr_text}" if stderr_text else "")
    )
    if process.returncode != 0 or not temporary_path.exists():
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    pixmap = QPixmap(str(temporary_path))
    diagnostics.append(f"flameshot_gui_path_file={temporary_path} pixmap={_describe_pixmap(pixmap)}")
    temporary_path.unlink(missing_ok=True)
    if pixmap.isNull():
        return None, diagnostics
    return pixmap, diagnostics


def _capture_via_grim() -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []
    if not shutil.which("grim"):
        diagnostics.append("grim=missing")
        return None, diagnostics
    # Retained for wlroots compositors. GNOME/Mutter does not support wlr-screencopy here.

    with tempfile.NamedTemporaryFile(prefix="domovik-qt-capture-", suffix=".png", delete=False) as handle:
        temporary_path = Path(handle.name)

    try:
        process = subprocess.run(
            ["grim", str(temporary_path)],
            capture_output=True,
            text=True,
            check=False,
            timeout=8,
            env=_build_tool_subprocess_env(),
        )
    except Exception as exc:
        diagnostics.append(f"grim=error:{exc}")
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    stdout_text = (process.stdout or "").strip()
    stderr_text = (process.stderr or "").strip()
    diagnostics.append(
        "grim="
        f"rc={process.returncode}"
        + (f" stdout={stdout_text}" if stdout_text else "")
        + (f" stderr={stderr_text}" if stderr_text else "")
    )
    if process.returncode != 0 or not temporary_path.exists():
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    pixmap = QPixmap(str(temporary_path))
    diagnostics.append(f"grim_file={temporary_path} pixmap={_describe_pixmap(pixmap)}")
    temporary_path.unlink(missing_ok=True)
    if pixmap.isNull():
        return None, diagnostics
    return pixmap, diagnostics


def _capture_via_gnome_shell_screenshot() -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []
    session_type = (os.environ.get("XDG_SESSION_TYPE", "") or "").strip().lower()
    desktop = (os.environ.get("XDG_CURRENT_DESKTOP", "") or "").strip()
    if session_type != "wayland" or "GNOME" not in desktop.upper():
        diagnostics.append("gnome_shell_screenshot=skipped")
        return None, diagnostics

    with tempfile.NamedTemporaryFile(prefix="domovik-qt-capture-", suffix=".png", delete=False) as handle:
        temporary_path = Path(handle.name)

    try:
        process = subprocess.run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.gnome.Shell.Screenshot",
                "--object-path",
                "/org/gnome/Shell/Screenshot",
                "--method",
                "org.gnome.Shell.Screenshot.Screenshot",
                "false",
                "false",
                str(temporary_path),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=8,
        )
    except Exception as exc:
        diagnostics.append(f"gnome_shell_screenshot=error:{exc}")
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    stdout_text = (process.stdout or "").strip()
    stderr_text = (process.stderr or "").strip()
    diagnostics.append(
        "gnome_shell_screenshot="
        f"rc={process.returncode}"
        + (f" stdout={stdout_text}" if stdout_text else "")
        + (f" stderr={stderr_text}" if stderr_text else "")
    )

    if process.returncode != 0 or not temporary_path.exists():
        temporary_path.unlink(missing_ok=True)
        return None, diagnostics

    pixmap = QPixmap(str(temporary_path))
    diagnostics.append(f"gnome_shell_file={temporary_path} pixmap={_describe_pixmap(pixmap)}")
    temporary_path.unlink(missing_ok=True)
    if pixmap.isNull():
        return None, diagnostics
    return pixmap, diagnostics


def _capture_via_portal_screenshot(*, interactive: bool = True) -> tuple[QPixmap | None, list[str]]:
    diagnostics: list[str] = []
    request_token = f"domovik{int(time.time() * 1000)}"

    monitor_process: subprocess.Popen | None = None
    try:
        monitor_process = subprocess.Popen(
            [
                "stdbuf",
                "-oL",
                "dbus-monitor",
                "--session",
                "sender=org.freedesktop.portal.Desktop",
                "interface=org.freedesktop.portal.Request",
                "member=Response",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        diagnostics.append(f"portal_monitor=error:{exc}")
        monitor_process = None

    try:
        process = subprocess.run(
            [
                "gdbus",
                "call",
                "--session",
                "--dest",
                "org.freedesktop.portal.Desktop",
                "--object-path",
                "/org/freedesktop/portal/desktop",
                "--method",
                "org.freedesktop.portal.Screenshot.Screenshot",
                "",
                "{'handle_token': <'%s'>, 'interactive': <%s>}" % (
                    request_token,
                    "true" if interactive else "false",
                ),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=8,
        )
    except Exception as exc:
        diagnostics.append(f"portal_screenshot=error:{exc}")
        return None, diagnostics

    stdout_text = (process.stdout or "").strip()
    stderr_text = (process.stderr or "").strip()
    diagnostics.append(
        "portal_screenshot="
        f"rc={process.returncode}"
        + f" interactive={interactive}"
        + (f" stdout={stdout_text}" if stdout_text else "")
        + (f" stderr={stderr_text}" if stderr_text else "")
    )

    if process.returncode != 0:
        if monitor_process is not None:
            _stop_monitor_process(monitor_process)
        return None, diagnostics

    handle_match = _OBJECT_PATH_PATTERN.search(stdout_text)
    if not handle_match:
        diagnostics.append("portal_handle=missing")
        if monitor_process is not None:
            _stop_monitor_process(monitor_process)
        return None, diagnostics

    handle_path = handle_match.group(1)
    diagnostics.append(f"portal_handle={handle_path}")
    response_code, response_payload, monitor_diagnostics = _wait_for_portal_response(
        handle_path,
        monitor_process,
    )
    diagnostics.extend(monitor_diagnostics)
    if response_code != 0:
        diagnostics.append(f"portal_response_code={response_code}")
        return None, diagnostics

    uri_match = _URI_PATTERN.search(response_payload)
    if not uri_match:
        diagnostics.append("portal_uri=missing")
        return None, diagnostics

    uri = uri_match.group(1)
    diagnostics.append(f"portal_uri={uri}")
    parsed_uri = urlparse(uri)
    if parsed_uri.scheme != "file":
        diagnostics.append(f"portal_uri_scheme={parsed_uri.scheme or 'unknown'}")
        return None, diagnostics

    local_path = Path(unquote(parsed_uri.path))
    if not local_path.exists():
        diagnostics.append(f"portal_file_missing={local_path}")
        return None, diagnostics

    pixmap = QPixmap(str(local_path))
    diagnostics.append(f"portal_pixmap={_describe_pixmap(pixmap)}")
    if pixmap.isNull():
        return None, diagnostics
    return pixmap, diagnostics


def _wait_for_portal_response(
    handle_path: str,
    process: subprocess.Popen | None,
) -> tuple[int, str, list[str]]:
    diagnostics: list[str] = []
    if process is None:
        diagnostics.append("portal_monitor=missing")
        return (1, "", diagnostics)

    captured_lines: list[str] = []
    handle_seen = False
    deadline = time.monotonic() + PORTAL_RESPONSE_TIMEOUT_SECONDS
    try:
        while time.monotonic() < deadline:
            if process.stdout is None:
                break

            ready, _, _ = select.select([process.stdout], [], [], 0.25)
            if not ready:
                continue

            line = process.stdout.readline()
            if not line:
                if process.poll() is not None:
                    break
                continue

            stripped_line = line.rstrip()
            if not stripped_line:
                continue
            if "org.freedesktop.portal.Request" not in stripped_line and handle_path not in stripped_line:
                continue
            captured_lines.append(stripped_line)
            if handle_path in stripped_line:
                handle_seen = True

            if not handle_seen:
                continue

            combined_text = "\n".join(captured_lines)
            response_code_match = _RESPONSE_CODE_PATTERN.search(combined_text)
            uri_match = _URI_PATTERN.search(combined_text)
            if response_code_match and (response_code_match.group(1) != "0" or uri_match):
                break
    finally:
        _stop_monitor_process(process)

    combined_text = "\n".join(captured_lines)
    diagnostics.append("portal_monitor_output=" + _summarize_monitor_output(captured_lines))
    if combined_text:
        diagnostics.append("portal_monitor_full=" + combined_text.replace("\n", "\\n"))
    response_code_match = _RESPONSE_CODE_PATTERN.search(combined_text)
    response_code = int(response_code_match.group(1)) if response_code_match else 1
    return (response_code, combined_text, diagnostics)


def _stop_monitor_process(process: subprocess.Popen) -> None:
    try:
        process.kill()
    except Exception:
        return

    try:
        process.wait(timeout=2)
    except Exception:
        pass


def _summarize_monitor_output(lines: list[str]) -> str:
    if not lines:
        return "none"
    tail_lines = lines[-12:]
    return " | ".join(tail_lines)


def _build_capture_environment_summary(
    message: str,
    *,
    candidate_screens: list | None = None,
    diagnostics: list[str] | None = None,
) -> str:
    parts = [message]
    parts.append(f"session={os.environ.get('XDG_SESSION_TYPE', 'unknown') or 'unknown'}")
    parts.append(f"qt_platform={os.environ.get('QT_QPA_PLATFORM', 'unset') or 'unset'}")
    parts.append(
        f"qt_platformtheme={os.environ.get('QT_QPA_PLATFORMTHEME', 'unset') or 'unset'}"
    )
    parts.append(f"screens={len(candidate_screens or [])}")
    if candidate_screens:
        parts.append(
            "screen_list="
            + ", ".join(
                f"{screen.name()}[{_format_geometry(screen.geometry())}]"
                for screen in candidate_screens
            )
        )
    if diagnostics:
        parts.append("attempts=" + " | ".join(diagnostics))
    return " ; ".join(parts)


def _describe_pixmap(pixmap: QPixmap) -> str:
    if pixmap.isNull():
        return "null"
    return f"{pixmap.width()}x{pixmap.height()}"


def _format_geometry(geometry) -> str:
    return f"{geometry.x()},{geometry.y()} {geometry.width()}x{geometry.height()}"


def scale_pixmap(source_pixmap: QPixmap, max_edge: int) -> QPixmap:
    if not max_edge or max_edge <= 0:
        return source_pixmap

    source_width = source_pixmap.width()
    source_height = source_pixmap.height()
    largest_edge = max(source_width, source_height)
    if largest_edge <= max_edge:
        return source_pixmap

    scale = max_edge / largest_edge
    target_width = max(1, round(source_width * scale))
    target_height = max(1, round(source_height * scale))

    return source_pixmap.scaled(
        target_width,
        target_height,
        aspectMode=Qt.AspectRatioMode.KeepAspectRatio,
        mode=Qt.TransformationMode.SmoothTransformation,
    )
