from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json


@dataclass
class ShellSettings:
    overlay_visible: bool = True
    always_on_top: bool = True
    push_to_talk_shortcut: str = "F8"
    push_to_talk_auto_send: bool = False
    auto_speak_replies: bool = False
    runtime_base_url: str = "http://127.0.0.1:3000"
    runtime_autostart: bool = False


def get_settings_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "qt-shell-settings.json"


def load_shell_settings() -> ShellSettings:
    settings_path = get_settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    if not settings_path.exists():
        return ShellSettings()

    try:
        raw_data = json.loads(settings_path.read_text(encoding="utf-8"))
    except Exception:
        return ShellSettings()

    return ShellSettings(
        overlay_visible=bool(raw_data.get("overlay_visible", True)),
        always_on_top=bool(raw_data.get("always_on_top", True)),
        push_to_talk_shortcut=str(raw_data.get("push_to_talk_shortcut", "F8")),
        push_to_talk_auto_send=bool(raw_data.get("push_to_talk_auto_send", False)),
        auto_speak_replies=bool(raw_data.get("auto_speak_replies", False)),
        runtime_base_url=str(raw_data.get("runtime_base_url", "http://127.0.0.1:3000")),
        runtime_autostart=bool(raw_data.get("runtime_autostart", False)),
    )


def save_shell_settings(shell_settings: ShellSettings) -> None:
    settings_path = get_settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(
        json.dumps(shell_settings.__dict__, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
