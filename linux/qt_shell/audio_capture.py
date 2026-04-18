from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import signal
import subprocess
import time


@dataclass
class RecorderStatus:
    available: bool
    backend_name: str
    detail: str


class NativeAudioRecorder:
    def __init__(self, data_root: Path) -> None:
        self.data_root = data_root
        self.data_root.mkdir(parents=True, exist_ok=True)
        self._process: subprocess.Popen[str] | None = None
        self._output_path: Path | None = None
        self._backend = self._detect_backend()

    def status(self) -> RecorderStatus:
        if self._backend is None:
            return RecorderStatus(False, "unavailable", "no supported native recorder found")
        return RecorderStatus(True, self._backend[0], f"using {self._backend[0]}")

    def is_recording(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def start(self) -> Path:
        if self.is_recording():
            raise RuntimeError("recording is already active")
        if self._backend is None:
            raise RuntimeError("no supported native recorder found")

        backend_name, command = self._backend
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        output_directory = self.data_root / "ptt-recordings"
        output_directory.mkdir(parents=True, exist_ok=True)
        output_path = output_directory / f"ptt-{timestamp}.wav"

        self._process = subprocess.Popen(
            [*command, str(output_path)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            text=True,
        )
        self._output_path = output_path
        return output_path

    def stop(self) -> Path:
        if not self.is_recording() or self._process is None or self._output_path is None:
            raise RuntimeError("no active recording session")

        process = self._process
        output_path = self._output_path

        try:
            os.killpg(os.getpgid(process.pid), signal.SIGINT)
        except ProcessLookupError:
            pass

        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)

        self._process = None
        self._output_path = None

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("recording completed but no audio data was written")

        return output_path

    def _detect_backend(self) -> tuple[str, list[str]] | None:
        candidates = [
            (
                "ffmpeg",
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "pulse",
                    "-i",
                    "default",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                ],
            ),
            ("arecord", ["arecord", "-f", "S16_LE", "-r", "16000", "-c", "1"]),
            ("pw-record", ["pw-record", "--format=s16", "--rate=16000", "--channels=1"]),
        ]

        for backend_name, command in candidates:
            if shutil_which(command[0]):
                return backend_name, command
        return None


def shutil_which(command: str) -> str | None:
    return next(
        (
            str(candidate)
            for search_path in os.environ.get("PATH", "").split(os.pathsep)
            if search_path
            for candidate in [Path(search_path) / command]
            if candidate.exists() and os.access(candidate, os.X_OK)
        ),
        None,
    )
