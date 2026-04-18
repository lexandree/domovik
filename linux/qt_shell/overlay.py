from __future__ import annotations

from PySide6.QtCore import Qt, QPoint
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QLabel, QWidget, QVBoxLayout


class OverlayWindow(QWidget):
    def __init__(self) -> None:
        super().__init__()
        self.assistant_name = "Domovik"
        self.setWindowTitle(self._build_window_title())
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.Tool
            | Qt.WindowType.WindowStaysOnTopHint
        )
        self.resize(220, 120)

        self.message_label = QLabel(f"{self.assistant_name} ready", self)
        self.message_label.setStyleSheet("color: white; font-size: 16px;")

        layout = QVBoxLayout()
        layout.addWidget(self.message_label)
        self.setLayout(layout)

    def set_message(self, text: str) -> None:
        self.message_label.setText(text)

    def set_assistant_name(self, assistant_name: str) -> None:
        normalized_name = (assistant_name or "Domovik").strip() or "Domovik"
        self.assistant_name = normalized_name
        self.setWindowTitle(self._build_window_title())

    def _build_window_title(self) -> str:
        return f"{self.assistant_name} companion overlay"

    def move_near_cursor(self, cursor_position: QPoint) -> None:
        self.move(cursor_position.x() + 24, cursor_position.y() + 24)

    def paintEvent(self, _event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        painter.setBrush(QColor(30, 34, 44, 220))
        painter.setPen(QPen(QColor(90, 170, 255, 220), 2))
        painter.drawRoundedRect(self.rect().adjusted(1, 1, -1, -1), 24, 24)
