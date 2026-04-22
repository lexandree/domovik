from __future__ import annotations

import os
from pathlib import Path
import sys
import base64
import json
import re

from .bootstrap import configure_qt_environment

configure_qt_environment()

from PySide6.QtCore import QTimer
from PySide6.QtGui import QCursor
from PySide6.QtWidgets import QApplication

from .audio_capture import NativeAudioRecorder
from .async_tasks import AsyncCall
from .bridge import RuntimeBridge
from .capture import capture_current_screen_as_data_url, has_gnome_screenshot
from .hotkeys import apply_hotkey_shortcut, detect_hotkey_backend, resolve_active_hotkey_shortcut
from .ipc_server import ShellIpcServer
from .overlay import OverlayWindow
from .panel import ControlPanelWindow
from .roi_selector import RoiSelectionDialog
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
        self.semantic_history: list[dict] = []
        self.latest_display_reply_text = ""
        self.visual_session_state = {
            "session_id": "",
            "full_image_data_url": "",
            "capture_summary": "",
            "rois": [],
            "cv_hints": [],
            "is_active": False,
        }
        self._capture_restore_visibility = {
            "panel": False,
            "overlay": False,
        }
        self.overlay_window = OverlayWindow()
        self.control_panel_window = ControlPanelWindow(
            runtime_status_provider=self.get_runtime_status_summary,
            on_refresh_status=self.refresh_runtime_status,
            on_show_overlay=self.show_overlay,
            on_hide_overlay=self.hide_overlay,
            on_start_runtime=self.start_runtime,
            on_stop_runtime=self.stop_runtime,
            on_capture_screen=self.capture_screen,
            on_clear_screenshot=self.clear_screenshot,
            on_select_roi=self.select_roi,
            on_clear_roi=self.clear_roi,
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
        self.control_panel_window.set_capture_available(False)
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
            active_mode = details.get("activeMode", "text")
            if text_provider == "minimax":
                text_model_name = details.get("miniMaxTextModel", "unknown")
                return ("online", f"mode: {active_mode} · MiniMax text: {text_model_name} · vision: {vision_provider}")
            if vision_provider == "openai_compat":
                model_name = details.get("visionModel", "unknown")
                return ("online", f"mode: {active_mode} · Vision model: {model_name}")
            model_name = details.get("anthropicModel", "unknown")
            return ("online", f"mode: {active_mode} · Anthropic model: {model_name}")

        error_text = runtime_status.details.get("error", "runtime offline")
        return ("offline", error_text)

    def capture_screen(self) -> None:
        if self.turn_state in {"capturing", "transcribing", "thinking", "requesting_speech"}:
            self.control_panel_window.set_capture_summary(f"{self.turn_state} · please wait")
            return

        session_type = (os.environ.get("XDG_SESSION_TYPE", "") or "").strip().lower()
        desktop = (os.environ.get("XDG_CURRENT_DESKTOP", "") or "").strip().upper()
        if session_type == "wayland" and "GNOME" in desktop and not has_gnome_screenshot():
            message = "gnome-screenshot is not installed. Install it first for screen capture on GNOME Wayland."
            self.control_panel_window.set_capture_summary(message)
            self.control_panel_window.set_response_text(message)
            self.overlay_window.set_message("capture unavailable")
            return

        self.turn_state = "capturing"
        self._refresh_interaction_state()
        self.control_panel_window.set_capture_summary("capturing screen…")
        self.overlay_window.set_message("capturing")
        self._capture_restore_visibility = {
            "panel": self.control_panel_window.isVisible(),
            "overlay": self.overlay_window.isVisible(),
        }
        self.control_panel_window.hide()
        self.overlay_window.hide()
        QTimer.singleShot(70, self._start_capture_async)

    def _start_capture_async(self) -> None:
        self._start_async_call(
            capture_current_screen_as_data_url,
            on_success=self._handle_capture_success,
            on_error=self._handle_capture_error,
        )

    def select_roi(self) -> None:
        if not self.visual_session_state["is_active"] or not self.visual_session_state["full_image_data_url"]:
            capture_summary = self.control_panel_window.capture_value_label.toPlainText().strip()
            if capture_summary and capture_summary != "none":
                self.control_panel_window.set_response_text(
                    f"No active screenshot is available for ROI selection.\n\nLast capture state: {capture_summary}"
                )
            else:
                self.control_panel_window.set_response_text("Capture a screen first.")
            return

        self.overlay_window.hide()
        dialog = RoiSelectionDialog(self.visual_session_state["full_image_data_url"], self.control_panel_window)
        if dialog.exec():
            selection_result = dialog.get_selection_result()
            if selection_result:
                self.visual_session_state["rois"] = [
                    {
                        "roiId": "qt-roi-1",
                        "label": "manual roi",
                        "origin": "manual",
                        "x": selection_result.x,
                        "y": selection_result.y,
                        "width": selection_result.width,
                        "height": selection_result.height,
                        "imageDataUrl": selection_result.image_data_url,
                    }
                ]
                self._save_latest_roi_debug_artifacts(selection_result)
                self.control_panel_window.set_capture_summary(
                    f"{self.visual_session_state['capture_summary']} · roi {selection_result.width}x{selection_result.height}"
                )
                self.overlay_window.set_message("roi selected")
        if self.shell_settings.overlay_visible:
            self.show_overlay()

    def clear_roi(self) -> None:
        self.visual_session_state["rois"] = []
        if self.visual_session_state["is_active"]:
            self.control_panel_window.set_capture_summary(self.visual_session_state["capture_summary"])
            self.overlay_window.set_message("roi cleared")

    def clear_screenshot(self) -> None:
        self.visual_session_state = {
            "session_id": "",
            "full_image_data_url": "",
            "capture_summary": "",
            "rois": [],
            "cv_hints": [],
            "is_active": False,
        }
        self.control_panel_window.set_capture_available(False)
        self.control_panel_window.set_capture_summary("none")
        self._refresh_interaction_state()

        try:
            self.runtime_bridge.clear_visual_session()
        except Exception as exc:
            self.control_panel_window.set_response_text(
                f"Screenshot cleared locally, but runtime visual session clear failed:\n\n{exc}"
            )
            self.overlay_window.set_message("screenshot cleared locally")
            return

        self.control_panel_window.set_response_text("Screenshot context cleared. Conversation history kept.")
        self.overlay_window.set_message("screenshot cleared")

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
            self.visual_session_state["full_image_data_url"],
            self.semantic_history[-10:],
            (
                "agentic_vision"
                if (
                    self.visual_session_state["is_active"] and
                    self.control_panel_window.should_use_agentic_recheck()
                )
                else (
                    "direct_vision"
                    if self.visual_session_state["is_active"]
                    else "text"
                )
            ),
            self.visual_session_state["is_active"] and self.control_panel_window.should_use_agentic_recheck(),
            self.visual_session_state["rois"],
            {"mode": "web"} if self.control_panel_window.should_use_web_search() else None,
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
        self.semantic_history = []
        response_text = (
            "Conversation history cleared. Current screenshot kept."
            if self.visual_session_state["is_active"]
            else "Conversation history cleared."
        )
        self.control_panel_window.set_response_text(response_text)
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
            active_mode = runtime_details.get("activeMode", "text")
            routing_state = runtime_details.get("backendRoutingState", {})
            if text_provider == "minimax":
                text_backend_summary = (
                    f"{runtime_details.get('miniMaxTextModel', 'unknown')} · "
                    f"{'available' if routing_state.get('textBackendAvailable') else 'unavailable'}"
                )
            else:
                text_backend_summary = (
                    f"shared with vision · "
                    f"{'available' if routing_state.get('textBackendAvailable') else 'unavailable'}"
                )
            vision_backend_summary = (
                f"{runtime_details.get('visionModel', 'unknown')}"
                if vision_provider == "openai_compat"
                else f"{runtime_details.get('anthropicModel', 'unknown')}"
            )
            vision_backend_summary = (
                f"{vision_backend_summary} · "
                f"{'available' if routing_state.get('visionBackendAvailable') else 'unavailable'}"
            )
            detail_summary = (
                f"text={text_provider} · "
                f"vision={vision_provider} · "
                f"visual_session={'present' if runtime_details.get('visualSessionActive') else 'empty'} · "
                f"rois={runtime_details.get('visualSessionRoiCount', 0)} · "
                f"search={self._format_last_search_summary(runtime_details.get('lastSearch'))} · "
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
            text_backend_summary = "unknown"
            vision_backend_summary = "unknown"
            active_mode = "text"

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
            text_backend_summary=text_backend_summary,
            vision_backend_summary=vision_backend_summary,
            routing_mode_summary=active_mode,
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

    def _format_last_search_summary(self, search_payload: object) -> str:
        if not isinstance(search_payload, dict) or not search_payload.get("used"):
            return "none"
        mode = str(search_payload.get("mode", "web"))
        provider = str(search_payload.get("provider", "unknown"))
        result_count = search_payload.get("resultCount", 0)
        step_count = search_payload.get("stepCount", 0)
        return f"{mode}/{provider}/{step_count}/{result_count}"

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

    def _save_latest_capture_debug_artifacts(self, capture_result) -> None:
        try:
            data_root = self._shell_data_root()
            debug_dir = data_root / "vision-debug" / "latest"
            debug_dir.mkdir(parents=True, exist_ok=True)

            image_path = debug_dir / "qt-capture.jpg"
            data_url = str(capture_result.data_url or "")
            match = re.match(r"^data:([^;]+);base64,(.+)$", data_url)
            if not match:
                return

            image_path.write_bytes(base64.b64decode(match.group(2)))

            meta = {
                "source": "qt-shell-capture",
                "summary": capture_result.summary,
                "width": capture_result.width,
                "height": capture_result.height,
                "file": str(image_path),
            }
            (debug_dir / "qt-capture.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            return

    def _save_latest_roi_debug_artifacts(self, selection_result) -> None:
        try:
            data_root = self._shell_data_root()
            debug_dir = data_root / "vision-debug" / "latest"
            debug_dir.mkdir(parents=True, exist_ok=True)

            image_path = debug_dir / "qt-roi.jpg"
            data_url = str(selection_result.image_data_url or "")
            match = re.match(r"^data:([^;]+);base64,(.+)$", data_url)
            if not match:
                return

            image_path.write_bytes(base64.b64decode(match.group(2)))

            meta = {
                "source": "qt-shell-roi",
                "x": selection_result.x,
                "y": selection_result.y,
                "width": selection_result.width,
                "height": selection_result.height,
                "file": str(image_path),
            }
            (debug_dir / "qt-roi.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            return

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

    def _handle_capture_success(self, capture_result) -> None:
        self.visual_session_state = {
            "session_id": f"qt-capture-{os.getpid()}-{len(self.semantic_history)}",
            "full_image_data_url": capture_result.data_url,
            "capture_summary": capture_result.summary,
            "rois": [],
            "cv_hints": [],
            "is_active": True,
        }
        self._save_latest_capture_debug_artifacts(capture_result)
        self.control_panel_window.set_capture_available(True)
        self.control_panel_window.set_capture_summary(capture_result.summary)
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self._restore_shell_windows_after_capture()
        self.overlay_window.set_message("screen captured")

    def _handle_capture_error(self, error_text: str) -> None:
        self.visual_session_state = {
            "session_id": "",
            "full_image_data_url": "",
            "capture_summary": "",
            "rois": [],
            "cv_hints": [],
            "is_active": False,
        }
        self.control_panel_window.set_capture_available(False)
        self.control_panel_window.set_capture_summary(f"capture failed: {error_text}")
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self._restore_shell_windows_after_capture()
        self.overlay_window.set_message("capture failed")

    def _handle_transcription_error(self, error_text: str) -> None:
        self.control_panel_window.set_push_to_talk_summary(f"transcription failed: {error_text}", False)
        self.control_panel_window.set_response_text(error_text)
        self.turn_state = "idle"
        self._refresh_interaction_state()
        self.overlay_window.set_message("transcription failed")

    def _handle_chat_success(self, prompt_text: str, response_payload: dict) -> None:
        plain_reply_text = str(response_payload.get("reply", "")).strip() or "No reply returned."
        display_payload = response_payload.get("display")
        debug_payload = response_payload.get("debug")
        response_mode = str(response_payload.get("mode", "")).strip()
        self.latest_reply_text = plain_reply_text
        self.latest_display_reply_text = self._build_display_reply_text(
            plain_reply_text,
            display_payload,
            response_payload.get("timings"),
            debug_payload,
        )
        self.control_panel_window.set_response_text(self.latest_display_reply_text)
        self.overlay_window.set_message(plain_reply_text)
        if response_mode not in {"local_identity", "vision_roi_required", "search_unavailable"}:
            self.semantic_history.append({"user": prompt_text, "assistant": plain_reply_text})
            self.semantic_history = self.semantic_history[-10:]
        self.turn_state = "idle"
        self._refresh_interaction_state()
        if self.control_panel_window.should_auto_speak_replies():
            self.speak_response()
        self.refresh_runtime_status()

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
            is_busy_turn=self.turn_state in {"capturing", "transcribing", "thinking", "requesting_speech"},
            is_recording=self.audio_recorder.is_recording(),
            is_speaking=self.speech_player.is_playing(),
        )

    def _restore_shell_windows_after_capture(self) -> None:
        if self._capture_restore_visibility.get("panel"):
            self.show_control_panel()
        if self._capture_restore_visibility.get("overlay") and self.shell_settings.overlay_visible:
            self.show_overlay()

    def _build_display_reply_text(
        self,
        plain_reply_text: str,
        display_payload: object,
        timings: object,
        debug_payload: object = None,
    ) -> str:
        if isinstance(display_payload, dict):
            display_text = str(display_payload.get("displayText", "")).strip()
            if display_text:
                if isinstance(debug_payload, dict):
                    debug_line = self._format_debug_payload(debug_payload)
                    if debug_line:
                        return f"{display_text}\n\n[debug: {debug_line}]"
                return display_text

        timing_summary = self._format_timing_summary(timings)
        response_text = plain_reply_text
        if timing_summary:
            response_text = f"{response_text}\n\n[{timing_summary}]"
        if isinstance(debug_payload, dict):
            debug_line = self._format_debug_payload(debug_payload)
            if debug_line:
                response_text = f"{response_text}\n\n[debug: {debug_line}]"
        return response_text

    def _format_debug_payload(self, debug_payload: dict) -> str:
        parts: list[str] = []
        if "screenshotPresent" in debug_payload:
            parts.append(f"screenshot={debug_payload.get('screenshotPresent')}")
        if "screenshotLength" in debug_payload:
            parts.append(f"len={debug_payload.get('screenshotLength')}")
        if "modeHint" in debug_payload:
            parts.append(f"hint={debug_payload.get('modeHint')}")
        if "resolvedMode" in debug_payload:
            parts.append(f"mode={debug_payload.get('resolvedMode')}")
        if "roiCount" in debug_payload:
            parts.append(f"rois={debug_payload.get('roiCount')}")
        if "searchMode" in debug_payload and debug_payload.get("searchMode"):
            parts.append(f"search={debug_payload.get('searchMode')}")
        if "searchSteps" in debug_payload:
            parts.append(f"search_steps={debug_payload.get('searchSteps')}")
        if "searchResultCount" in debug_payload:
            parts.append(f"search_results={debug_payload.get('searchResultCount')}")
        if "searchFinalQuery" in debug_payload and debug_payload.get("searchFinalQuery"):
            parts.append(f"query={debug_payload.get('searchFinalQuery')}")
        if "searchDebugPath" in debug_payload:
            parts.append(f"search_log={debug_payload.get('searchDebugPath')}")
        if "visionDebugDirectory" in debug_payload:
            parts.append(f"saved={debug_payload.get('visionDebugDirectory')}")
        return " · ".join(parts)

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
