from __future__ import annotations

from dataclasses import dataclass
import base64

from PySide6.QtCore import QBuffer, QIODevice
from PySide6.QtGui import QCursor, QGuiApplication, QImage, QPixmap


MAX_SCREENSHOT_EDGE = 2000
JPEG_QUALITY = 82


@dataclass
class ScreenshotCaptureResult:
    data_url: str
    summary: str


def capture_current_screen_as_data_url() -> ScreenshotCaptureResult:
    cursor_position = QCursor.pos()
    target_screen = QGuiApplication.screenAt(cursor_position)
    if target_screen is None:
        target_screen = QGuiApplication.primaryScreen()

    if target_screen is None:
        raise RuntimeError("No screen is available for capture.")

    screenshot_pixmap = target_screen.grabWindow(0)
    if screenshot_pixmap.isNull():
        raise RuntimeError("Screen capture returned an empty image.")

    scaled_pixmap = scale_pixmap(screenshot_pixmap, MAX_SCREENSHOT_EDGE)

    image_buffer = QBuffer()
    image_buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    scaled_pixmap.save(image_buffer, "JPEG", JPEG_QUALITY)

    image_base64 = base64.b64encode(bytes(image_buffer.data())).decode("ascii")
    screenshot_data_url = f"data:image/jpeg;base64,{image_base64}"
    screenshot_summary = (
        f"{target_screen.name()} · "
        f"{scaled_pixmap.width()}x{scaled_pixmap.height()} px"
    )
    return ScreenshotCaptureResult(
        data_url=screenshot_data_url,
        summary=screenshot_summary,
    )


def scale_pixmap(source_pixmap: QPixmap, max_edge: int) -> QPixmap:
    if not max_edge or max_edge <= 0:
        return source_pixmap

    source_width = source_pixmap.width()
    source_height = source_pixmap.height()
    largest_edge = max(source_width, source_height)
    if largest_edge <= max_edge:
        return source_pixmap

    scale = max_edge / largest_edge
    target_width = max(1, round(source_width * scale))
    target_height = max(1, round(source_height * scale))

    return source_pixmap.scaled(
        target_width,
        target_height,
        aspectMode=QImage.AspectRatioMode.KeepAspectRatio,
        mode=QImage.TransformationMode.SmoothTransformation,
    )
