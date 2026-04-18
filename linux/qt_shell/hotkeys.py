from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import subprocess

from .ipc_server import IPC_PORT


PORTAL_DESTINATION = "org.freedesktop.portal.Desktop"
PORTAL_OBJECT_PATH = "/org/freedesktop/portal/desktop"
GLOBAL_SHORTCUTS_INTERFACE = "org.freedesktop.portal.GlobalShortcuts"
GNOME_EXTENSION_UUID = "assistant-ptt@local"
GNOME_EXTENSION_SETTINGS_SCHEMA = "org.gnome.shell.extensions.assistant-ptt"


@dataclass(frozen=True)
class HotkeyBackendState:
    backend_name: str
    is_supported: bool
    shortcut: str
    detail: str


def detect_hotkey_backend(shortcut: str) -> HotkeyBackendState:
    normalized_shortcut = (shortcut or "F8").strip() or "F8"
    session_type = os.environ.get("XDG_SESSION_TYPE", "").strip().lower()
    desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").strip()

    if _portal_has_global_shortcuts():
        return HotkeyBackendState(
            backend_name="portal",
            is_supported=False,
            shortcut=normalized_shortcut,
            detail="GlobalShortcuts portal detected, but shell registration is not wired yet",
        )

    if session_type == "wayland" and "GNOME" in desktop.upper():
        if _gnome_extension_is_enabled():
            return HotkeyBackendState(
                backend_name="gnome_extension",
                is_supported=True,
                shortcut=normalized_shortcut,
                detail=f"GNOME extension backend active via localhost:{IPC_PORT}",
            )

        if _gnome_extension_is_installed():
            return HotkeyBackendState(
                backend_name="gnome_extension",
                is_supported=False,
                shortcut=normalized_shortcut,
                detail="GNOME extension backend is installed but not enabled",
            )

        return HotkeyBackendState(
            backend_name="gnome_extension",
            is_supported=False,
            shortcut=normalized_shortcut,
            detail="GNOME extension backend is available in the repo but not installed",
        )

    if session_type == "wayland":
        detail = "Wayland session exposes no supported global shortcuts backend"
    elif session_type == "x11":
        detail = "X11 session detected, but no global shortcuts backend is implemented yet"
    else:
        detail = "No supported global shortcuts backend detected"

    return HotkeyBackendState(
        backend_name="manual",
        is_supported=False,
        shortcut=normalized_shortcut,
        detail=detail,
    )


def resolve_active_hotkey_shortcut(fallback_shortcut: str) -> str:
    normalized_fallback = (fallback_shortcut or "F8").strip() or "F8"
    session_type = os.environ.get("XDG_SESSION_TYPE", "").strip().lower()
    desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").strip()

    if session_type == "wayland" and "GNOME" in desktop.upper():
        gnome_shortcut = _get_gnome_extension_shortcut()
        if gnome_shortcut:
            return gnome_shortcut

    return normalized_fallback


def _portal_has_global_shortcuts() -> bool:
    try:
        process = subprocess.run(
            [
                "gdbus",
                "introspect",
                "--session",
                "--dest",
                PORTAL_DESTINATION,
                "--object-path",
                PORTAL_OBJECT_PATH,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=4,
        )
    except Exception:
        return False

    if process.returncode != 0:
        return False

    return GLOBAL_SHORTCUTS_INTERFACE in process.stdout


def _gnome_extension_directory() -> Path:
    return Path.home() / ".local" / "share" / "gnome-shell" / "extensions" / GNOME_EXTENSION_UUID


def _gnome_extension_is_installed() -> bool:
    return _gnome_extension_directory().exists()


def _gnome_extension_is_enabled() -> bool:
    if not _gnome_extension_is_installed():
        return False

    try:
        process = subprocess.run(
            ["gsettings", "get", "org.gnome.shell", "enabled-extensions"],
            capture_output=True,
            text=True,
            check=False,
            timeout=4,
        )
    except Exception:
        return False

    if process.returncode != 0:
        return False

    return GNOME_EXTENSION_UUID in process.stdout


def apply_hotkey_shortcut(shortcut: str) -> tuple[bool, str]:
    normalized_shortcut = (shortcut or "F8").strip() or "F8"
    session_type = os.environ.get("XDG_SESSION_TYPE", "").strip().lower()
    desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").strip()

    if session_type == "wayland" and "GNOME" in desktop.upper():
        schema_directory = _gnome_extension_directory() / "schemas"
        if not schema_directory.exists():
            return (False, "failed to update GNOME shortcut: extension schema directory is missing")
        try:
            process = subprocess.run(
                [
                    "gsettings",
                    "--schemadir",
                    str(schema_directory),
                    "set",
                    GNOME_EXTENSION_SETTINGS_SCHEMA,
                    "push-to-talk-shortcut",
                    f"['{normalized_shortcut}']",
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=4,
            )
        except Exception as exc:
            return (False, f"failed to update GNOME shortcut: {exc}")

        if process.returncode != 0:
            error_text = process.stderr.strip() or process.stdout.strip() or "unknown gsettings error"
            return (False, f"failed to update GNOME shortcut: {error_text}")

        return (True, f"GNOME shortcut updated to {normalized_shortcut}")

    return (True, f"saved shortcut {normalized_shortcut}")


def _get_gnome_extension_shortcut() -> str:
    schema_directory = _gnome_extension_directory() / "schemas"
    if not schema_directory.exists():
        return ""

    try:
        process = subprocess.run(
            [
                "gsettings",
                "--schemadir",
                str(schema_directory),
                "get",
                GNOME_EXTENSION_SETTINGS_SCHEMA,
                "push-to-talk-shortcut",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=4,
        )
    except Exception:
        return ""

    if process.returncode != 0:
        return ""

    raw_text = process.stdout.strip()
    if not raw_text.startswith("[") or not raw_text.endswith("]"):
        return ""

    inner_text = raw_text[1:-1].strip()
    if not inner_text:
        return ""

    if inner_text.startswith("'") and inner_text.endswith("'"):
        inner_text = inner_text[1:-1]

    return inner_text.strip()
