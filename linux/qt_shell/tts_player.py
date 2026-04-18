from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time

from PySide6.QtCore import QObject, QUrl
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer


@dataclass(frozen=True)
class SpeechPlaybackState:
    is_playing: bool
    detail: str


class SpeechPlayer(QObject):
    def __init__(self, data_root: Path) -> None:
        super().__init__()
        self.data_root = data_root
        self.audio_output = QAudioOutput()
        self.audio_output.setVolume(1.0)
        self.player = QMediaPlayer()
        self.player.setAudioOutput(self.audio_output)
        self.player.playbackStateChanged.connect(self._handle_state_change)
        self._current_audio_path: Path | None = None

    def play_mp3_bytes(self, audio_bytes: bytes) -> SpeechPlaybackState:
        playback_directory = self.data_root / "tts-playback"
        playback_directory.mkdir(parents=True, exist_ok=True)

        audio_path = playback_directory / f"tts-{int(time.time() * 1000)}.mp3"
        audio_path.write_bytes(audio_bytes)
        self._current_audio_path = audio_path
        self.player.setSource(QUrl.fromLocalFile(str(audio_path)))
        self.player.play()
        return self.get_state()

    def stop(self) -> SpeechPlaybackState:
        self.player.stop()
        return self.get_state()

    def is_playing(self) -> bool:
        return self.player.isPlaying()

    def get_state(self) -> SpeechPlaybackState:
        if self.player.isPlaying():
            return SpeechPlaybackState(is_playing=True, detail="speaking")
        if self._current_audio_path:
            return SpeechPlaybackState(is_playing=False, detail="speech ready")
        return SpeechPlaybackState(is_playing=False, detail="idle")

    def _handle_state_change(self, _state) -> None:
        if self.player.isPlaying():
            return
        self._cleanup_previous_audio_file()

    def _cleanup_previous_audio_file(self) -> None:
        if not self._current_audio_path:
            return
        try:
            self._current_audio_path.unlink(missing_ok=True)
        except Exception:
            pass
        self._current_audio_path = None
