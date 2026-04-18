from __future__ import annotations

from PySide6.QtGui import QAction, QCursor, QGuiApplication, QIcon, QPixmap, QColor
from PySide6.QtWidgets import QMenu, QSystemTrayIcon

from .overlay import OverlayWindow


def create_default_icon() -> QIcon:
    pixmap = QPixmap(32, 32)
    pixmap.fill(QColor(0, 0, 0, 0))
    pixmap.fill(QColor(53, 115, 219))
    return QIcon(pixmap)


class TrayController:
    def __init__(
        self,
        overlay_window: OverlayWindow,
        show_panel_callback,
        start_push_to_talk_callback,
        stop_push_to_talk_callback,
    ) -> None:
        self.overlay_window = overlay_window
        self.show_panel_callback = show_panel_callback
        self.start_push_to_talk_callback = start_push_to_talk_callback
        self.stop_push_to_talk_callback = stop_push_to_talk_callback
        self.tray_icon = QSystemTrayIcon(create_default_icon())
        self.menu = QMenu()

        self.show_panel_action = QAction("Show Control Panel")
        self.show_panel_action.triggered.connect(self.show_panel_callback)

        self.show_overlay_action = QAction("Show companion")
        self.show_overlay_action.triggered.connect(self.show_overlay)

        self.hide_overlay_action = QAction("Hide companion")
        self.hide_overlay_action.triggered.connect(self.overlay_window.hide)

        self.start_push_to_talk_action = QAction("Start Push-to-Talk")
        self.start_push_to_talk_action.triggered.connect(self.start_push_to_talk_callback)

        self.stop_push_to_talk_action = QAction("Stop Push-to-Talk")
        self.stop_push_to_talk_action.triggered.connect(self.stop_push_to_talk_callback)

        self.quit_action = QAction("Quit")
        self.quit_action.triggered.connect(self.quit_application)

        self.menu.addAction(self.show_panel_action)
        self.menu.addAction(self.show_overlay_action)
        self.menu.addAction(self.hide_overlay_action)
        self.menu.addSeparator()
        self.menu.addAction(self.start_push_to_talk_action)
        self.menu.addAction(self.stop_push_to_talk_action)
        self.menu.addSeparator()
        self.menu.addAction(self.quit_action)
        self.tray_icon.setContextMenu(self.menu)
        self.tray_icon.activated.connect(self.handle_activation)

    def show(self) -> None:
        self.tray_icon.show()

    def set_push_to_talk_state(self, is_recording: bool) -> None:
        self.start_push_to_talk_action.setEnabled(not is_recording)
        self.stop_push_to_talk_action.setEnabled(is_recording)

    def show_overlay(self) -> None:
        self.overlay_window.move_near_cursor(QCursor.pos())
        self.overlay_window.show()
        self.overlay_window.raise_()

    def handle_activation(self, reason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.show_panel_callback()

    def quit_application(self) -> None:
        self.tray_icon.hide()
        self.overlay_window.hide()
        QGuiApplication.quit()
