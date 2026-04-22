from __future__ import annotations

import os
from pathlib import Path
import shutil


def configure_qt_environment() -> None:
    # Configure Qt before importing PySide6 modules. On Ubuntu GNOME, the GTK3
    # platform theme plugin can crash against the local xsettings schema. Use a
    # lighter fallback theme layer for the shell and disable the GTK3 theme
    # plugin in the active environment if it exists.
    requested_qt_platform = os.environ.get("DOMOVIK_QT_PLATFORM", "").strip()
    if requested_qt_platform:
        os.environ["QT_QPA_PLATFORM"] = requested_qt_platform
    os.environ.setdefault("QT_QPA_PLATFORMTHEME", "xdgdesktopportal")
    os.environ.setdefault("QT_STYLE_OVERRIDE", "Fusion")
    disable_problematic_qgtk3_plugin()


def disable_problematic_qgtk3_plugin() -> None:
    for plugin_directory in find_platform_theme_directories():
        qgtk3_plugin_path = plugin_directory / "libqgtk3.so"
        if not qgtk3_plugin_path.exists():
            continue

        disabled_directory = plugin_directory / ".disabled-by-assistant"
        disabled_directory.mkdir(parents=True, exist_ok=True)
        disabled_plugin_path = disabled_directory / qgtk3_plugin_path.name

        if disabled_plugin_path.exists():
            qgtk3_plugin_path.unlink()
            continue

        shutil.move(str(qgtk3_plugin_path), str(disabled_plugin_path))


def find_platform_theme_directories() -> list[Path]:
    plugin_paths = []

    qt_plugin_path = os.environ.get("QT_PLUGIN_PATH", "").strip()
    if qt_plugin_path:
        plugin_paths.extend([Path(entry) for entry in qt_plugin_path.split(os.pathsep) if entry])

    candidate_roots = [
        Path(__file__).resolve().parents[3],
        Path(os.environ.get("VIRTUAL_ENV", "")),
    ]

    for candidate_root in candidate_roots:
        if not candidate_root:
            continue
        plugin_root = candidate_root / "lib"
        if not plugin_root.exists():
            continue
        plugin_paths.extend(plugin_root.glob("python*/site-packages/PySide6/Qt/plugins"))

    platform_theme_directories = []
    for plugin_path in plugin_paths:
        plugin_directory = Path(plugin_path) / "platformthemes"
        if plugin_directory.exists():
            platform_theme_directories.append(plugin_directory)

    return platform_theme_directories
