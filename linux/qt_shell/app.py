from __future__ import annotations

import os
from pathlib import Path
import sys
import base64
import re

from .bootstrap import configure_qt_environment

configure_qt_environment()

from PySide6.QtCore import QTimer
from PySide6.QtGui import QCursor
from PySide6.QtWidgets import QApplication

from .audio_capture import NativeAudioRecorder
from .async_tasks import AsyncCall
from .bridge import RuntimeBridge
from .capture import capture_current_screen_as_data_url
from .hotkeys import apply_hotkey_shortcut, detect_hotkey_backend, resolve_active_hotkey_shortcut
from .ipc_server import ShellIpcServer
from .overlay import OverlayWindow
from .panel import ControlPanelWindow
from .runtime import RuntimeProcessController
from .settings import load_shell_settings, save_shell_settings
from .tray import TrayController
from .tts_player import SpeechPlayer


class ShellApplication:
    def __init__(self) -> None:
        self.qt_application = QApplication(sys.argv)
        self.qt_application.setQuitOnLastWindowClosed(False)
        self.qt_application.aboutToQuit.connect(self.shutdown)
        self.assistant_name = "Domovik"

        self.shell_settings = load_shell_settings()
        self.shell_settings.push_to_talk_shortcut = resolve_active_hotkey_shortcut(
            self.shell_settings.push_to_talk_shortcut
        )
        save_shell_settings(self.shell_settings)
        self.runtime_bridge = RuntimeBridge(self.shell_settings.runtime_base_url)
        self.runtime_process_controller = RuntimeProcessController()
        self.audio_recorder = NativeAudioRecorder(self._shell_data_root())
        self.speech_player = SpeechPlayer(self._shell_data_root())
        self.turn_state = "idle"
        self.latest_reply_text = ""
        self._active_async_calls: set[AsyncCall] = set()
        self.hotkey_backend_state = detect_hotkey_backend(self.shell_settings.push_to_talk_shortcut)
        self.ipc_server = ShellIpcServer(
            on_start=self.start_push_to_talk,
            on_stop=self.stop_push_to_talk,
            on_toggle=self.toggle_push_to_talk,
            on_show_panel=self.show_control_panel,
        )
        self.conversation_history: list[dict] = []
        self.latest_screenshot_data_url = ""
        self.overlay_window = OverlayWindow()
        self.control_panel_window = ControlPanelWindow(
            runtime_status_provider=self.get_runtime_status_summary,
            on_refresh_status=self.refresh_runtime_status,
            on_show_overlay=self.show_overlay,
            on_hide_overlay=self.hide_overlay,
            on_start_runtime=self.start_runtime,
            on_stop_runtime=self.stop_runtime,
            on_capture_screen=self.capture_screen,
            on_start_push_to_talk=self.start_push_to_talk,
            on_stop_push_to_talk=self.stop_push_to_talk,
            on_apply_push_to_talk_shortcut=self.apply_push_to_talk_shortcut,
            on_ask_runtime=self.ask_runtime,
            on_clear_history=self.clear_conversation_history,
            on_speak_response=self.speak_response,
            on_stop_speech=self.stop_speech,
            on_overlay_toggle=self.set_overlay_visible_on_launch,
            initial_overlay_visible=self.shell_settings.overlay_visible,
            initial_push_to_talk_auto_send=self.shell_settings.push_to_talk_auto_send,
            initial_auto_speak_replies=self.shell_settings.auto_speak_replies,
            initial_push_to_talk_shortcut=self.shell_settings.push_to_talk_shortcut,
        )
        self.control_panel_window.push_to_talk_auto_send_checkbox.toggled.connect(
            self.set_push_to_talk_auto_send
        )
        self.control_panel_window.auto_speak_replies_checkbox.toggled.connect(
            self.set_auto_speak_replies
        )
        self.tray_controller = TrayController(
            self.overlay_window,
            self.show_control_panel,
            self.start_push_to_talk,
            self.stop_push_to_talk,
        )
        self.tray_controller.set_push_to_talk_state(False)
        self.cursor_follow_timer = QTimer()
        self.cursor_follow_timer.timeout.connect(self.follow_cursor)
        self.cursor_follow_timer.start(120)
        self.runtime_status_timer = QTimer()
        self.runtime_status_timer.timeout.connect(self.refresh_runtime_status)
        self.runtime_status_timer.start(3000)
        self.ipc_server.start()

        if self.shell_settings.runtime_autostart:
            self.start_runtime()
        self.refresh_runtime_status()
        self._refresh_interaction_state()

    def follow_cursor(self) -> None:
        if self.overlay_window.isVisible():
            self.overlay_window.move_near_cursor(QCursor.pos())

    def show_overlay(self) -> None:
        self.overlay_window.move_near_cursor(QCursor.pos())
        self.overlay_window.show()
        self.overlay_window.raise_()

    def hide_overlay(self) -> None:
        self.overlay_window.hide()

    def show_control_panel(self) -> None:
        self.control_panel_window.show()
        self.control_panel_window.raise_()
        self.control_panel_window.activateWindow()

    def set_overlay_visible_on_launch(self, is_visible: bool) -> None:
        self.shell_settings.overlay_visible = is_visible
        save_shell_settings(self.shell_settings)

    def set_push_to_talk_auto_send(self, is_enabled: bool) -> None:
        self.shell_settings.push_to_talk_auto_send = is_enabled
        save_shell_settings(self.shell_settings)

    def set_auto_speak_replies(self, is_enabled: bool) -> None:
        self.shell_settings.auto_speak_replies = is_enabled
        save_shell_settings(self.shell_settings)

    def apply_push_to_talk_shortcut(self, shortcut: str) -> None:
        normalized_shortcut = (shortcut or "F8").strip() or "F8"
        ok, detail = apply_hotkey_shortcut(normalized_shortcut)
        if not ok:
            self.control_panel_window.set_response_text(detail)
            self.overlay_window.set_message("shortcut update failed")
            return

        self.shell_settings.push_to_talk_shortcut = normalized_shortcut
        save_shell_settings(self.shell_settings)
        self.hotkey_backend_state = detect_hotkey_backend(normalized_shortcut)
        self.control_panel_window.set_response_text(detail)
        self.overlay_window.set_message("shortcut updated")
        self.refresh_runtime_status()

    def start_runtime(self) -> None:
        self.runtime_process_controller.start()
        self.refresh_runtime_status()

    def stop_runtime(self) -> None:
        self.runtime_process_controller.stop()
        self.refresh_runtime_status()

    def get_runtime_status_summary(self) -> tuple[str, str]:
        runtime_status = self.runtime_bridge.get_status()
        if runtime_status.ok:
            details = runtime_status.details
            text_provider = details.get("textProvider", "unknown")
            vision_provider = details.get("visionProvider", "unknown")
            if text_provider == "minimax":
                text_model_name = details.get("miniMaxTextModel", "unknown")
                return ("online", f"MiniMax text: {text_model_name} · vision: {vision_provider}")
            if vision_provider == "openai_compat":
                model_name = details.get("openAiCompatibleModel", "unknown")
                return ("online", f"OpenAI-compatible model: {model_name}")
            model_name = details.get("anthropicModel", "unknown")
            return ("online", f"Anthropic model: {model_name}")

        error_text = runtime_status.details.get("error", "runtime offline")
        return ("offline", error_text)

    def capture_screen(self) -> None:
        try:
            capture_result = capture_current_screen_as_data_url()
        except Exception as exc:
            self.control_panel_window.set_capture_summary(f"capture failed: {exc}")
            self.overlay_window.set_message("capture failed")
            return

        self.latest_screenshot_data_url = capture_result.data_url
        self.control_panel_window.set_capture_summary(capture_result.summary)
        self.overlay_window.set_message("screen captured")

    def start_push_to_talk(self) -> None:
        if self.turn_state in {"transcribing", "thinking", "requesting_speech"}:
            self.control_panel_window.set_push_to_talk_summary(f"{self.turn_state} · please wait", False)
            self.overlay_window.set_message(self.turn_state)
            return

        self.stop_speech()
        try:
            output_path = self.audio_recorder.start()
        except Exception as exc:
            self.control_panel_window.set_push_to_talk_summary(f"capture failed: {exc}", False)
            self.control_panel_window.set_response_text(str(exc))
            self.overlay_window.set_message("push-to-talk failed")
            return

        recorder_status = self.audio_recorder.status()
        self.control_panel_window.set_push_to_talk_summary(
            f"recording via {recorder_status.backend_name} · {output_path.name}",
            True,
        )
        self.turn_state = "recording"
        self._refresh_interaction_state()
        self.tray_controller.set_push_to_talk_state(True)
        self.overlay_window.set_message("listening")

    def stop_push_to_talk(self) -> None:
        try:
            audio_path = self.audio_recorder.stop()
        except Exception as exc:
            self.control_panel_window.set_push_to_talk_summary(f"stop failed: {exc}", False)
            self.control_panel_window.set_response_text(str(exc))
            self.turn_state = "idle"
            self._refresh_interaction_state()
            self.overlay_window.set_message("push-to-talk failed")
            return

        self.control_panel_window.set_push_to_talk_summary("transcribing", False)
        self.tray_controller.set_push_to_talk_state(False)
        self.turn_state = "transcribing"
        self._refresh_interaction_state()
        self.overlay_window.set_message("transcribing")
        self._start_async_call(
            self.runtime_bridge.transcribe_audio_file,
            audio_path,
            on_success=self._handle_transcription_success,
            on_error=self._handle_transcription_error,
        )

    def toggle_push_to_talk(self) -> None:
        if self.audio_recorder.is_recording():
            self.stop_push_to_talk()
            return
        self.start_push_to_talk()

    def ask_runtime(self) -> None:
        if self.turn_state in {"transcribing", "thinking", "requesting_speech"}:
            self.control_panel_window.set_response_text(f"{self.turn_state} in progress. Please wait.")
            return

        self.stop_speech()
        prompt_text = self.control_panel_window.get_prompt_text()
        if not prompt_text:
            self.control_panel_window.set_response_text("Please enter a prompt first.")
            return

        self.turn_state = "thinking"
        self.control_panel_window.set_push_to_talk_summary("thinking", False)
        self._refresh_interaction_state()
        self.overlay_window.set_message("thinking")
        self._start_async_call(
            self.runtime_bridge.ask_chat,
            prompt_text,
            self.latest_screenshot_data_url,
            self.conversation_history[-10:],
            on_success=lambda payload: self._handle_chat_success(prompt_text, payload),
            on_error=self._handle_chat_error,
        )

    def speak_response(self) -> None:
        if self.turn_state in {"transcribing", "thinking", "requesting_speech"}:
            self.control_panel_window.set_speech_summary(f"{self.turn_state} · please wait")
            return

        response_text = self.latest_reply_text.strip()
        if not response_text:
            self.control_panel_window.set_speech_summary("no response to speak")
            return

        self.stop_speech()
        self.control_panel_window.set_speech_summary("requesting speech")
        self.turn_state = "requesting_speech"
        self._refresh_interaction_state()
        self.overlay_window.set_message("requesting speech")
        self._start_async_call(
            self.runtime_bridge.synthesize_speech,
            response_text,
            on_success=self._handle_tts_success,
            on_error=self._handle_tts_error,
        )

    def stop_speech(self) -> None:
        playback_state = self.speech_player.stop()
        self.control_panel_window.set_speech_summary(playback_state.detail)
        self._refresh_interaction_state()

    def clear_conversation_history(self) -> None:
        self.conversation_history = []
        self.control_panel_window.set_response_text("conversation history cleared")
        self.overlay_window.set_message("history cleared")

    def refresh_runtime_status(self) -> None:
        runtime_status = self.runtime_bridge.get_status()
        if runtime_status.ok:
            runtime_details = runtime_status.details
            self.assistant_name = str(runtime_details.get("assistantName", "Domovik")).strip() or "Domovik"
            self.overlay_window.set_assistant_name(self.assistant_name)
            self.control_panel_window.set_assistant_name(self.assistant_name)
            self.overlay_window.set_message(f"{self.assistant_name} ready")
            text_provider = runtime_details.get("textProvider", "unknown")
            vision_provider = runtime_details.get("visionProvider", "unknown")
            if text_provider == "minimax":
                model_name = runtime_details.get("miniMaxTextModel", "unknown")
            else:
                model_name = (
                    runtime_details.get("openAiCompatibleModel", "unknown")
                    if vision_provider == "openai_compat"
                    else runtime_details.get("anthropicModel", "unknown")
                )
            detail_summary = (
                f"text={text_provider} · "
                f"vision={vision_provider} · "
                f"model={model_name} · "
                f"stt={runtime_details.get('speechToTextProvider', 'unknown')} · "
                f"port={runtime_details.get('port', 'unknown')}"
            )
            status_summary = "online"
        else:
            self.overlay_window.set_assistant_name(self.assistant_name)
            self.control_panel_window.set_assistant_name(self.assistant_name)
            self.overlay_window.set_message("runtime offline")
            detail_summary = runtime_status.details.get("error", "runtime offline")
            status_summary = "offline"

        runtime_process_state = self.runtime_process_controller.get_state()
        if runtime_process_state.is_running:
            if runtime_process_state.is_managed_by_shell:
                runtime_process_summary = f"managed by shell · pid {runtime_process_state.pid}"
            else:
                runtime_process_summary = f"external runtime detected · pid {runtime_process_state.pid}"
        else:
            runtime_process_summary = "not managed by shell"

        self.control_panel_window.refresh_labels(
            runtime_summary=status_summary,
            runtime_details=detail_summary,
            runtime_process_summary=runtime_process_summary,
        )
        active_shortcut = resolve_active_hotkey_shortcut(self.shell_settings.push_to_talk_shortcut)
        if active_shortcut != self.shell_settings.push_to_talk_shortcut:
            self.shell_settings.push_to_talk_shortcut = active_shortcut
            save_shell_settings(self.shell_settings)
            self.hotkey_backend_state = detect_hotkey_backend(active_shortcut)
        self.control_panel_window.set_hotkey_summary(
            self.hotkey_backend_state.detail,
            self.hotkey_backend_state.shortcut,
        )
        self.control_panel_window.set_runtime_button_state(runtime_process_state.is_running)
        self.control_panel_window.set_speech_summary(self.speech_player.get_state().detail)
        if not self.audio_recorder.is_recording():
            self.hotkey_backend_state = detect_hotkey_backend(self.shell_settings.push_to_talk_shortcut)
            recorder_status = self.audio_recorder.status()
            self.control_panel_window.set_push_to_talk_summary(
                self._build_push_to_talk_status(recorder_status),
                False,
            )
            self.tray_controller.set_push_to_talk_state(False)
        self._refresh_interaction_state()

    def _format_timing_summary(self, timings: object, total_only: bool = False) -> str:
        if not isinstance(timings, dict):
            return ""

        timing_parts: list[str] = []
        provider_ms = timings.get("providerMs")
        total_ms = timings.get("totalMs")

        if not total_only and isinstance(provider_ms, (int, float)):
            timing_parts.append(f"provider {self._format_milliseconds(provider_ms)}")
        if isinstance(total_ms, (int, float)):
            timing_parts.append(f"total {self._format_milliseconds(total_ms)}")

        return " · ".join(timing_parts)

    def _format_milliseconds(self, value: float) -> str:
        if value >= 1000:
            return f"{value / 1000:.2f}s"
        return f"{int(round(value))}ms"

    def _build_push_to_talk_status(self, recorder_status) -> str:
        if not recorder_status.available:
            return "native capture unavailable"
        if self.hotkey_backend_state.is_supported:
            return (
                f"{recorder_status.detail} · "
                f"press {self.hotkey_backend_state.shortcut} to start, "
                f"press again to stop"
            )
        return f"{recorder_status.detail} · manual push-to-talk fallback"

    def _shell_data_root(self):
        return Path(__file__).resolve().parents[1] / "data"

    def shutdown(self) -> None:
        self.ipc_server.stop()
        self.speech_player.stop()
        self.runtime_process_controller.stop_managed_runtime()

    def _handle_transcription_success(self, transcription_payload: dict) -> None:
        transcript = str(transcription_payload.get("transcript", "")).strip()
        timings = transcription_payload.get("timings")
        timing_summary = self._format_timing_summary(timings, total_only=True)
        self.control_panel_window.set_prompt_text(transcript)
        self.control_panel_window.set_push_to_talk_summary(
            f"transcript ready{f' · {timing_summary}' if timing_summary else ''}",
            False,
        )
        self.control_panel_window.set_response_text(
            transcript if not timing_summary else f"{transcript}\n\n[{timing_summary}]"
        )
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self.overlay_window.set_message("transcript ready")
        if self.control_panel_window.should_auto_send_transcript():
            self.ask_runtime()

    def _handle_transcription_error(self, error_text: str) -> None:
        self.control_panel_window.set_push_to_talk_summary(f"transcription failed: {error_text}", False)
        self.control_panel_window.set_response_text(error_text)
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self.overlay_window.set_message("transcription failed")

    def _handle_chat_success(self, prompt_text: str, response_payload: dict) -> None:
        plain_reply_text = str(response_payload.get("reply", "")).strip() or "No reply returned."
        self.latest_reply_text = plain_reply_text
        response_text = plain_reply_text
        timing_summary = self._format_timing_summary(response_payload.get("timings"))
        if timing_summary:
            response_text = f"{response_text}\n\n[{timing_summary}]"
        self.control_panel_window.set_response_text(response_text)
        self.overlay_window.set_message(plain_reply_text)
        self.conversation_history.append({"user": prompt_text, "assistant": plain_reply_text})
        self.conversation_history = self.conversation_history[-10:]
        self.turn_state = "idle"
        self._refresh_interaction_state()
        if self.control_panel_window.should_auto_speak_replies():
            self.speak_response()

    def _handle_chat_error(self, error_text: str) -> None:
        self.control_panel_window.set_response_text(error_text)
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self.overlay_window.set_message("request failed")

    def _handle_tts_success(self, tts_payload: dict) -> None:
        audio_bytes = base64.b64decode(str(tts_payload.get("audioBase64", "")))
        playback_state = self.speech_player.play_mp3_bytes(audio_bytes)
        self.control_panel_window.set_speech_summary(playback_state.detail)
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self.overlay_window.set_message(playback_state.detail)

    def _handle_tts_error(self, error_text: str) -> None:
        self.control_panel_window.set_speech_summary(f"speech failed: {error_text}")
        self.control_panel_window.set_response_text(error_text)
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self.overlay_window.set_message("speech failed")

    def _start_async_call(self, fn, *args, on_success, on_error) -> None:
        async_call = AsyncCall(fn, *args)
        self._active_async_calls.add(async_call)
        async_call.signals.succeeded.connect(on_success)
        async_call.signals.failed.connect(on_error)
        async_call.signals.finished.connect(lambda: self._active_async_calls.discard(async_call))
        async_call.start()

    def _refresh_interaction_state(self) -> None:
        self.control_panel_window.set_interaction_state(
            is_busy_turn=self.turn_state in {"transcribing", "thinking", "requesting_speech"},
            is_recording=self.audio_recorder.is_recording(),
            is_speaking=self.speech_player.is_playing(),
        )

    def run(self) -> int:
        self.tray_controller.show()
        self.show_control_panel()
        if self.shell_settings.overlay_visible:
            self.show_overlay()
        return self.qt_application.exec()


def main() -> int:
    shell_application = ShellApplication()
    return shell_application.run()


if __name__ == "__main__":
    raise SystemExit(main())
