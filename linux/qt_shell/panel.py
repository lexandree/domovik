from __future__ import annotations

from collections.abc import Callable

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class ControlPanelWindow(QWidget):
    def __init__(
        self,
        runtime_status_provider: Callable[[], tuple[str, str]],
        on_refresh_status: Callable[[], None],
        on_show_overlay: Callable[[], None],
        on_hide_overlay: Callable[[], None],
        on_start_runtime: Callable[[], None],
        on_stop_runtime: Callable[[], None],
        on_capture_screen: Callable[[], None],
        on_clear_screenshot: Callable[[], None],
        on_select_roi: Callable[[], None],
        on_clear_roi: Callable[[], None],
        on_start_push_to_talk: Callable[[], None],
        on_stop_push_to_talk: Callable[[], None],
        on_apply_push_to_talk_shortcut: Callable[[str], None],
        on_ask_runtime: Callable[[], None],
        on_clear_history: Callable[[], None],
        on_speak_response: Callable[[], None],
        on_stop_speech: Callable[[], None],
        on_overlay_toggle: Callable[[bool], None],
        initial_overlay_visible: bool,
        initial_push_to_talk_auto_send: bool,
        initial_auto_speak_replies: bool,
        initial_push_to_talk_shortcut: str,
    ) -> None:
        super().__init__()
        self.runtime_status_provider = runtime_status_provider
        self.on_refresh_status = on_refresh_status
        self.on_show_overlay = on_show_overlay
        self.on_hide_overlay = on_hide_overlay
        self.on_start_runtime = on_start_runtime
        self.on_stop_runtime = on_stop_runtime
        self.on_capture_screen = on_capture_screen
        self.on_clear_screenshot = on_clear_screenshot
        self.on_select_roi = on_select_roi
        self.on_clear_roi = on_clear_roi
        self.on_start_push_to_talk = on_start_push_to_talk
        self.on_stop_push_to_talk = on_stop_push_to_talk
        self.on_apply_push_to_talk_shortcut = on_apply_push_to_talk_shortcut
        self.on_ask_runtime = on_ask_runtime
        self.on_clear_history = on_clear_history
        self.on_speak_response = on_speak_response
        self.on_stop_speech = on_stop_speech
        self.on_overlay_toggle = on_overlay_toggle
        self.assistant_name = "Domovik"
        self.has_active_capture = False

        self.setWindowTitle(self._build_window_title())
        self.resize(560, 520)

        self.status_value_label = QLabel("unknown")
        self.details_value_label = QLabel("unknown")
        self.runtime_process_label = QLabel("not managed")
        self.text_backend_label = QLabel("unknown")
        self.vision_backend_label = QLabel("unknown")
        self.routing_mode_label = QLabel("text")
        self.capture_value_label = QPlainTextEdit()
        self.capture_value_label.setReadOnly(True)
        self.capture_value_label.setPlainText("none")
        self.capture_value_label.setFixedHeight(92)
        self.push_to_talk_value_label = QLabel("idle")
        self.hotkey_backend_value_label = QLabel("manual")
        self.shortcut_value_label = QLabel("F8")
        self.speech_value_label = QLabel("idle")

        self.status_value_label.setStyleSheet("font-weight: 600;")
        self.status_value_label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        self.details_value_label.setWordWrap(True)
        self.details_value_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.text_backend_label.setWordWrap(True)
        self.vision_backend_label.setWordWrap(True)
        self.routing_mode_label.setWordWrap(True)
        self.push_to_talk_value_label.setWordWrap(True)
        self.hotkey_backend_value_label.setWordWrap(True)
        self.shortcut_value_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.speech_value_label.setWordWrap(True)

        self.prompt_text_edit = QPlainTextEdit()
        self.prompt_text_edit.setPlaceholderText("Ask Domovik about your current screen...")
        self.prompt_text_edit.setFixedHeight(92)

        self.response_text_edit = QTextEdit()
        self.response_text_edit.setReadOnly(True)
        self.response_text_edit.setPlaceholderText("Runtime replies will appear here.")
        self.response_text_edit.setFixedHeight(140)

        self.show_overlay_button = QPushButton("Show Overlay")
        self.show_overlay_button.clicked.connect(self.on_show_overlay)

        self.hide_overlay_button = QPushButton("Hide Overlay")
        self.hide_overlay_button.clicked.connect(self.on_hide_overlay)

        self.refresh_button = QPushButton("Refresh Runtime Status")
        self.refresh_button.clicked.connect(self.on_refresh_status)

        self.start_runtime_button = QPushButton("Start Runtime")
        self.start_runtime_button.setCheckable(True)
        self.start_runtime_button.clicked.connect(self.on_start_runtime)

        self.stop_runtime_button = QPushButton("Stop Runtime")
        self.stop_runtime_button.setCheckable(True)
        self.stop_runtime_button.clicked.connect(self.on_stop_runtime)

        self.capture_screen_button = QPushButton("Capture Screen")
        self.capture_screen_button.clicked.connect(self.on_capture_screen)

        self.select_roi_button = QPushButton("Select ROI")
        self.select_roi_button.clicked.connect(self.on_select_roi)
        self.select_roi_button.setEnabled(False)

        self.clear_screenshot_button = QPushButton("Clear Screenshot")
        self.clear_screenshot_button.clicked.connect(self.on_clear_screenshot)
        self.clear_screenshot_button.setEnabled(False)

        self.clear_roi_button = QPushButton("Clear ROI")
        self.clear_roi_button.clicked.connect(self.on_clear_roi)
        self.clear_roi_button.setEnabled(False)

        self.start_push_to_talk_button = QPushButton("Start Push-to-Talk")
        self.start_push_to_talk_button.setCheckable(True)
        self.start_push_to_talk_button.clicked.connect(self.on_start_push_to_talk)

        self.stop_push_to_talk_button = QPushButton("Stop Push-to-Talk")
        self.stop_push_to_talk_button.setCheckable(True)
        self.stop_push_to_talk_button.clicked.connect(self.on_stop_push_to_talk)

        self.ask_runtime_button = QPushButton("Ask Runtime")
        self.ask_runtime_button.clicked.connect(self.on_ask_runtime)

        self.clear_history_button = QPushButton("Clear Chat History")
        self.clear_history_button.clicked.connect(self.on_clear_history)

        self.speak_response_button = QPushButton("Speak Response")
        self.speak_response_button.clicked.connect(self.on_speak_response)

        self.stop_speech_button = QPushButton("Stop Speech")
        self.stop_speech_button.clicked.connect(self.on_stop_speech)

        self.overlay_visible_checkbox = QCheckBox("[ ] Show companion on launch")
        self.overlay_visible_checkbox.setChecked(initial_overlay_visible)
        self.overlay_visible_checkbox.toggled.connect(self.on_overlay_toggle)
        self.overlay_visible_checkbox.toggled.connect(
            lambda checked: self._sync_checkbox_label(self.overlay_visible_checkbox, "Show companion on launch", checked)
        )

        self.push_to_talk_auto_send_checkbox = QCheckBox("[ ] Auto-send transcript after capture")
        self.push_to_talk_auto_send_checkbox.setChecked(initial_push_to_talk_auto_send)
        self.push_to_talk_auto_send_checkbox.toggled.connect(
            lambda checked: self._sync_checkbox_label(self.push_to_talk_auto_send_checkbox, "Auto-send transcript after capture", checked)
        )

        self.auto_speak_replies_checkbox = QCheckBox("[ ] Auto-speak replies")
        self.auto_speak_replies_checkbox.setChecked(initial_auto_speak_replies)
        self.auto_speak_replies_checkbox.toggled.connect(
            lambda checked: self._sync_checkbox_label(self.auto_speak_replies_checkbox, "Auto-speak replies", checked)
        )

        self.agentic_recheck_checkbox = QCheckBox("[ ] Use agentic re-check for screenshot turns")
        self.agentic_recheck_checkbox.toggled.connect(
            lambda checked: self._sync_checkbox_label(self.agentic_recheck_checkbox, "Use agentic re-check for screenshot turns", checked)
        )

        self.web_search_checkbox = QCheckBox("[ ] Use web search for this turn")
        self.web_search_checkbox.toggled.connect(
            lambda checked: self._sync_checkbox_label(self.web_search_checkbox, "Use web search for this turn", checked)
        )

        self.push_to_talk_shortcut_edit = QLineEdit(initial_push_to_talk_shortcut)
        self.push_to_talk_shortcut_edit.setPlaceholderText("F8")

        self.apply_push_to_talk_shortcut_button = QPushButton("Apply Shortcut")
        self.apply_push_to_talk_shortcut_button.clicked.connect(self._apply_push_to_talk_shortcut)

        shell_card = QFrame()
        shell_card.setStyleSheet(
            "QFrame {"
            "background-color: rgba(28, 31, 40, 235);"
            "border: 1px solid rgba(90, 170, 255, 80);"
            "border-radius: 18px;"
            "}"
            "QLabel { color: white; }"
            "QPushButton {"
            "background-color: rgba(90, 170, 255, 210);"
            "background-image: qlineargradient(x1:0, y1:0, x2:0, y2:1, "
            "stop:0 rgba(122, 190, 255, 235), stop:1 rgba(62, 136, 220, 225));"
            "color: #0f1520;"
            "border-radius: 12px;"
            "border: 1px solid rgba(175, 222, 255, 90);"
            "padding: 8px 12px;"
            "font-weight: 700;"
            "}"
            "QPushButton:pressed, QPushButton:checked {"
            "background-color: rgba(50, 112, 188, 235);"
            "background-image: qlineargradient(x1:0, y1:0, x2:0, y2:1, "
            "stop:0 rgba(53, 118, 198, 240), stop:1 rgba(30, 73, 130, 240));"
            "padding-top: 10px;"
            "padding-bottom: 6px;"
            "border: 1px solid rgba(142, 209, 255, 140);"
            "}"
            "QPushButton:disabled {"
            "background-color: rgba(82, 95, 118, 180);"
            "background-image: none;"
            "color: rgba(210, 221, 238, 180);"
            "border: 1px solid rgba(135, 149, 172, 80);"
            "}"
            "QCheckBox { color: white; }"
            "QCheckBox::indicator {"
            "width: 18px;"
            "height: 18px;"
            "border-radius: 5px;"
            "border: 2px solid rgba(18, 23, 32, 235);"
            "background: rgba(255, 250, 241, 235);"
            "}"
            "QCheckBox::indicator:checked {"
            "image: none;"
            "background: rgba(255, 250, 241, 245);"
            "border: 2px solid rgba(12, 15, 21, 245);"
            "}"
            "QLineEdit {"
            "background-color: rgba(16, 19, 26, 235);"
            "color: #f3f7ff;"
            "border: 1px solid rgba(110, 143, 189, 120);"
            "border-radius: 12px;"
            "padding: 8px 10px;"
            "selection-background-color: rgba(90, 170, 255, 150);"
            "selection-color: #ffffff;"
            "}"
            "QPlainTextEdit, QTextEdit {"
            "background-color: rgba(16, 19, 26, 235);"
            "color: #f3f7ff;"
            "border: 1px solid rgba(110, 143, 189, 120);"
            "border-radius: 14px;"
            "padding: 10px 12px;"
            "selection-background-color: rgba(90, 170, 255, 150);"
            "selection-color: #ffffff;"
            "}"
            "QTextEdit[readOnly=\"true\"] {"
            "background-color: rgba(12, 15, 21, 245);"
            "}"
        )

        shell_layout = QVBoxLayout()
        shell_layout.setContentsMargins(18, 18, 18, 18)
        shell_layout.setSpacing(14)

        self.headline_label = QLabel("Domovik linux shell")
        self.headline_label.setStyleSheet("font-size: 22px; font-weight: 700;")
        shell_layout.addWidget(self.headline_label)

        status_grid = QGridLayout()
        status_grid.addWidget(QLabel("Runtime status"), 0, 0)
        status_grid.addWidget(self.status_value_label, 0, 1)
        status_grid.addWidget(QLabel("Managed process"), 1, 0)
        status_grid.addWidget(self.runtime_process_label, 1, 1)
        status_grid.addWidget(QLabel("Text backend"), 2, 0)
        status_grid.addWidget(self.text_backend_label, 2, 1)
        status_grid.addWidget(QLabel("Vision backend"), 3, 0)
        status_grid.addWidget(self.vision_backend_label, 3, 1)
        status_grid.addWidget(QLabel("Routing mode"), 4, 0)
        status_grid.addWidget(self.routing_mode_label, 4, 1)
        status_grid.addWidget(QLabel("Details"), 5, 0)
        status_grid.addWidget(self.details_value_label, 5, 1)
        status_grid.addWidget(QLabel("Last capture"), 6, 0)
        status_grid.addWidget(self.capture_value_label, 6, 1)
        status_grid.addWidget(QLabel("Push-to-talk"), 7, 0)
        status_grid.addWidget(self.push_to_talk_value_label, 7, 1)
        status_grid.addWidget(QLabel("Hotkey backend"), 8, 0)
        status_grid.addWidget(self.hotkey_backend_value_label, 8, 1)
        status_grid.addWidget(QLabel("Shortcut"), 9, 0)
        status_grid.addWidget(self.shortcut_value_label, 9, 1)
        status_grid.addWidget(QLabel("Speech"), 10, 0)
        status_grid.addWidget(self.speech_value_label, 10, 1)
        status_grid.setColumnStretch(1, 1)
        shell_layout.addLayout(status_grid)

        overlay_button_row = QHBoxLayout()
        overlay_button_row.addWidget(self.show_overlay_button)
        overlay_button_row.addWidget(self.hide_overlay_button)
        shell_layout.addLayout(overlay_button_row)

        runtime_button_row = QHBoxLayout()
        runtime_button_row.addWidget(self.refresh_button)
        runtime_button_row.addWidget(self.start_runtime_button)
        runtime_button_row.addWidget(self.stop_runtime_button)
        shell_layout.addLayout(runtime_button_row)

        capture_button_row = QHBoxLayout()
        capture_button_row.addWidget(self.capture_screen_button)
        capture_button_row.addWidget(self.clear_screenshot_button)
        capture_button_row.addWidget(self.select_roi_button)
        capture_button_row.addWidget(self.clear_roi_button)
        capture_button_row.addWidget(self.ask_runtime_button)
        capture_button_row.addWidget(self.clear_history_button)
        shell_layout.addLayout(capture_button_row)

        speech_button_row = QHBoxLayout()
        speech_button_row.addWidget(self.speak_response_button)
        speech_button_row.addWidget(self.stop_speech_button)
        shell_layout.addLayout(speech_button_row)

        push_to_talk_button_row = QHBoxLayout()
        push_to_talk_button_row.addWidget(self.start_push_to_talk_button)
        push_to_talk_button_row.addWidget(self.stop_push_to_talk_button)
        shell_layout.addLayout(push_to_talk_button_row)

        shortcut_row = QHBoxLayout()
        shortcut_row.addWidget(self.push_to_talk_shortcut_edit)
        shortcut_row.addWidget(self.apply_push_to_talk_shortcut_button)
        shell_layout.addLayout(shortcut_row)

        shell_layout.addWidget(QLabel("Prompt"))
        shell_layout.addWidget(self.prompt_text_edit)
        shell_layout.addWidget(QLabel("Response"))
        shell_layout.addWidget(self.response_text_edit)
        shell_layout.addWidget(self.overlay_visible_checkbox)
        shell_layout.addWidget(self.push_to_talk_auto_send_checkbox)
        shell_layout.addWidget(self.auto_speak_replies_checkbox)
        shell_layout.addWidget(self.web_search_checkbox)
        shell_layout.addWidget(self.agentic_recheck_checkbox)
        shell_card.setLayout(shell_layout)

        root_layout = QVBoxLayout()
        root_layout.setContentsMargins(16, 16, 16, 16)
        root_layout.addWidget(shell_card)
        self.setLayout(root_layout)

        self._sync_checkbox_label(self.overlay_visible_checkbox, "Show companion on launch", initial_overlay_visible)
        self._sync_checkbox_label(
            self.push_to_talk_auto_send_checkbox,
            "Auto-send transcript after capture",
            initial_push_to_talk_auto_send,
        )
        self._sync_checkbox_label(
            self.auto_speak_replies_checkbox,
            "Auto-speak replies",
            initial_auto_speak_replies,
        )
        self._sync_checkbox_label(
            self.agentic_recheck_checkbox,
            "Use agentic re-check for screenshot turns",
            False,
        )
        self._sync_checkbox_label(
            self.web_search_checkbox,
            "Use web search for this turn",
            False,
        )

    def set_assistant_name(self, assistant_name: str) -> None:
        normalized_name = (assistant_name or "Domovik").strip() or "Domovik"
        self.assistant_name = normalized_name
        self.setWindowTitle(self._build_window_title())
        self.headline_label.setText(f"{self.assistant_name} linux shell")

    def _build_window_title(self) -> str:
        return f"{self.assistant_name} control panel"

    def refresh_labels(
        self,
        runtime_summary: str,
        runtime_details: str,
        runtime_process_summary: str,
        text_backend_summary: str = "unknown",
        vision_backend_summary: str = "unknown",
        routing_mode_summary: str = "text",
    ) -> None:
        self.status_value_label.setText(runtime_summary)
        self.details_value_label.setText(runtime_details)
        self.runtime_process_label.setText(runtime_process_summary)
        self.text_backend_label.setText(text_backend_summary)
        self.vision_backend_label.setText(vision_backend_summary)
        self.routing_mode_label.setText(routing_mode_summary)
        if runtime_summary == "online":
            self.status_value_label.setStyleSheet("font-weight: 600; color: #76e39c;")
        elif runtime_summary == "offline":
            self.status_value_label.setStyleSheet("font-weight: 600; color: #ff8f8f;")
        else:
            self.status_value_label.setStyleSheet("font-weight: 600; color: white;")

    def set_capture_summary(self, capture_summary: str) -> None:
        self.capture_value_label.setPlainText(capture_summary)

    def set_capture_available(self, is_available: bool) -> None:
        self.has_active_capture = is_available
        self.clear_screenshot_button.setEnabled(is_available)

    def set_push_to_talk_summary(self, push_to_talk_summary: str, is_recording: bool) -> None:
        self.push_to_talk_value_label.setText(push_to_talk_summary)
        self.start_push_to_talk_button.setChecked(is_recording)
        self.stop_push_to_talk_button.setChecked(not is_recording)

    def set_hotkey_summary(self, hotkey_backend_summary: str, shortcut: str) -> None:
        self.hotkey_backend_value_label.setText(hotkey_backend_summary)
        self.shortcut_value_label.setText(shortcut)
        self.push_to_talk_shortcut_edit.setText(shortcut)

    def set_runtime_button_state(self, is_running: bool) -> None:
        self.start_runtime_button.setChecked(is_running)
        self.stop_runtime_button.setChecked(not is_running)

    def set_speech_summary(self, speech_summary: str) -> None:
        self.speech_value_label.setText(speech_summary)

    def set_interaction_state(self, *, is_busy_turn: bool, is_recording: bool, is_speaking: bool) -> None:
        self.capture_screen_button.setEnabled(not is_busy_turn and not is_recording)
        self.clear_screenshot_button.setEnabled(self.has_active_capture and not is_busy_turn and not is_recording)
        self.select_roi_button.setEnabled(self.has_active_capture and not is_busy_turn and not is_recording)
        self.clear_roi_button.setEnabled(self.has_active_capture and not is_busy_turn and not is_recording)
        self.ask_runtime_button.setEnabled(not is_busy_turn and not is_recording)
        self.clear_history_button.setEnabled(not is_busy_turn and not is_recording)
        self.start_push_to_talk_button.setEnabled(not is_recording and not is_busy_turn)
        self.stop_push_to_talk_button.setEnabled(is_recording)
        self.speak_response_button.setEnabled(not is_busy_turn and not is_speaking)
        self.stop_speech_button.setEnabled(is_speaking)
        self.apply_push_to_talk_shortcut_button.setEnabled(not is_busy_turn and not is_recording)
        self.push_to_talk_shortcut_edit.setEnabled(not is_busy_turn and not is_recording)
        self.push_to_talk_auto_send_checkbox.setEnabled(not is_busy_turn and not is_recording)
        self.auto_speak_replies_checkbox.setEnabled(not is_busy_turn and not is_recording)

    def get_prompt_text(self) -> str:
        return self.prompt_text_edit.toPlainText().strip()

    def set_prompt_text(self, prompt_text: str) -> None:
        self.prompt_text_edit.setPlainText(prompt_text)

    def set_response_text(self, response_text: str) -> None:
        self.response_text_edit.setPlainText(response_text)

    def should_auto_send_transcript(self) -> bool:
        return self.push_to_talk_auto_send_checkbox.isChecked()

    def should_auto_speak_replies(self) -> bool:
        return self.auto_speak_replies_checkbox.isChecked()

    def should_use_agentic_recheck(self) -> bool:
        return self.agentic_recheck_checkbox.isChecked()

    def should_use_web_search(self) -> bool:
        return self.web_search_checkbox.isChecked()

    def _sync_checkbox_label(self, checkbox: QCheckBox, label: str, checked: bool) -> None:
        checkbox.setText(f"[{'x' if checked else ' '}] {label}")

    def _apply_push_to_talk_shortcut(self) -> None:
        self.on_apply_push_to_talk_shortcut(self.push_to_talk_shortcut_edit.text())
