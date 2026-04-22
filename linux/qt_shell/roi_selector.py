from __future__ import annotations

import base64
from dataclasses import dataclass

from PySide6.QtCore import QPoint, QRect, QSize, Qt
from PySide6.QtGui import QColor, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QDialog


@dataclass
class RoiSelectionResult:
    x: int
    y: int
    width: int
    height: int
    image_data_url: str


class RoiSelectionDialog(QDialog):
    def __init__(self, screenshot_data_url: str, parent=None) -> None:
        super().__init__(parent)
        self._source_data_url = screenshot_data_url
        self._source_pixmap = self._pixmap_from_data_url(screenshot_data_url)
        self._display_rect = QRect()
        self._drag_start = QPoint()
        self._drag_current = QPoint()
        self._selection_result: RoiSelectionResult | None = None

        self.setWindowTitle("Select ROI")
        self.setModal(True)
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.Dialog
            | Qt.WindowType.WindowStaysOnTopHint
        )
        self.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose, True)
        self.setCursor(Qt.CursorShape.CrossCursor)

        screen = self.screen()
        if screen is not None:
            self.setGeometry(screen.geometry())
        else:
            self.resize(1600, 900)

    def get_selection_result(self) -> RoiSelectionResult | None:
        return self._selection_result

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if event.button() != Qt.MouseButton.LeftButton:
            if event.button() == Qt.MouseButton.RightButton:
                self.reject()
            return

        if not self._display_rect.contains(event.position().toPoint()):
            return

        self._drag_start = event.position().toPoint()
        self._drag_current = self._drag_start
        self.update()

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if self._drag_start.isNull():
            return

        self._drag_current = self._clamp_to_display_rect(event.position().toPoint())
        self.update()

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        if event.button() != Qt.MouseButton.LeftButton or self._drag_start.isNull():
            return

        self._drag_current = self._clamp_to_display_rect(event.position().toPoint())
        selection_rect = QRect(self._drag_start, self._drag_current).normalized()
        self._drag_start = QPoint()
        self._drag_current = QPoint()

        if selection_rect.width() < 12 or selection_rect.height() < 12:
            self.update()
            return

        self._selection_result = self._build_result(selection_rect)
        self.accept()

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Escape:
            self.reject()
            return
        super().keyPressEvent(event)

    def paintEvent(self, _event) -> None:  # noqa: N802
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor(10, 12, 18, 180))

        if self._source_pixmap.isNull():
            return

        target_size = self._source_pixmap.size()
        target_size.scale(self.size(), Qt.AspectRatioMode.KeepAspectRatio)
        x = (self.width() - target_size.width()) // 2
        y = (self.height() - target_size.height()) // 2
        self._display_rect = QRect(x, y, target_size.width(), target_size.height())
        painter.drawPixmap(self._display_rect, self._source_pixmap)

        painter.setPen(QPen(QColor(255, 255, 255, 180), 2, Qt.PenStyle.DashLine))
        painter.drawRect(self._display_rect)

        selection_rect = self._current_selection_rect()
        if not selection_rect.isNull():
            painter.fillRect(selection_rect, QColor(90, 170, 255, 70))
            painter.setPen(QPen(QColor(255, 255, 255, 230), 2))
            painter.drawRect(selection_rect)

        hint_rect = QRect(self._display_rect.left(), max(12, self._display_rect.top() - 42), min(620, self._display_rect.width()), 30)
        painter.fillRect(hint_rect, QColor(12, 15, 21, 220))
        painter.setPen(QColor(255, 255, 255))
        painter.drawText(
            hint_rect.adjusted(10, 0, -10, 0),
            Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft,
            "Drag to select ROI. Left click-drag to accept, Esc/right click to cancel.",
        )

    def _current_selection_rect(self) -> QRect:
        if self._drag_start.isNull() or self._drag_current.isNull():
            return QRect()
        return QRect(self._drag_start, self._drag_current).normalized()

    def _clamp_to_display_rect(self, point: QPoint) -> QPoint:
        if self._display_rect.isNull():
            return point
        return QPoint(
            max(self._display_rect.left(), min(point.x(), self._display_rect.right())),
            max(self._display_rect.top(), min(point.y(), self._display_rect.bottom())),
        )

    def _build_result(self, display_selection_rect: QRect) -> RoiSelectionResult:
        scale_x = self._source_pixmap.width() / max(1, self._display_rect.width())
        scale_y = self._source_pixmap.height() / max(1, self._display_rect.height())
        local_rect = display_selection_rect.translated(-self._display_rect.topLeft())
        image_rect = QRect(
            round(local_rect.left() * scale_x),
            round(local_rect.top() * scale_y),
            max(1, round(local_rect.width() * scale_x)),
            max(1, round(local_rect.height() * scale_y)),
        )
        cropped_pixmap = self._source_pixmap.copy(image_rect)
        image_data_url = self._pixmap_to_data_url(cropped_pixmap)
        return RoiSelectionResult(
            x=image_rect.x(),
            y=image_rect.y(),
            width=image_rect.width(),
            height=image_rect.height(),
            image_data_url=image_data_url,
        )

    def _pixmap_from_data_url(self, data_url: str) -> QPixmap:
        if "," not in data_url:
            return QPixmap()
        try:
            _, encoded = data_url.split(",", 1)
            raw_bytes = base64.b64decode(encoded)
        except Exception:
            return QPixmap()

        pixmap = QPixmap()
        pixmap.loadFromData(raw_bytes)
        return pixmap

    def _pixmap_to_data_url(self, pixmap: QPixmap) -> str:
        if pixmap.isNull():
            return ""
        byte_array = bytearray()
        from PySide6.QtCore import QBuffer, QIODevice  # local import to keep module light

        buffer = QBuffer()
        buffer.open(QIODevice.OpenModeFlag.WriteOnly)
        pixmap.save(buffer, "JPEG", 90)
        byte_array.extend(bytes(buffer.data()))
        encoded = base64.b64encode(byte_array).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
