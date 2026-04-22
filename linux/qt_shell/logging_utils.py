from __future__ import annotations

from datetime import datetime
import json
import os
from pathlib import Path


LOG_LEVEL_SILENT = 0
LOG_LEVEL_ERRORS = 1
LOG_LEVEL_INFO = 2
LOG_LEVEL_DEBUG = 3
DEFAULT_LOG_LEVEL = LOG_LEVEL_INFO


def get_log_level() -> int:
    raw_value = os.environ.get("LOG_LEVEL", "").strip()
    if not raw_value:
        return DEFAULT_LOG_LEVEL
    try:
        return max(LOG_LEVEL_SILENT, int(raw_value))
    except Exception:
        return DEFAULT_LOG_LEVEL


def get_shell_log_path() -> Path:
    log_directory = Path(__file__).resolve().parents[1] / "data" / "logs"
    log_directory.mkdir(parents=True, exist_ok=True)
    return log_directory / "qt-shell.log"


def log_event(level: int, event: str, **payload) -> None:
    if get_log_level() < level:
        return

    record = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "event": event,
        "payload": payload,
    }
    with get_shell_log_path().open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
