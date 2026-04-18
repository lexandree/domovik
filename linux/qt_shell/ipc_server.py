from __future__ import annotations

from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from typing import Callable

from PySide6.QtCore import QObject, Signal


IPC_HOST = "127.0.0.1"
IPC_PORT = 39667


class ShellIpcBridge(QObject):
    start_requested = Signal()
    stop_requested = Signal()
    toggle_requested = Signal()
    show_panel_requested = Signal()


@dataclass(frozen=True)
class ShellIpcServerState:
    host: str
    port: int
    is_running: bool


class ShellIpcServer:
    def __init__(
        self,
        on_start: Callable[[], None],
        on_stop: Callable[[], None],
        on_toggle: Callable[[], None],
        on_show_panel: Callable[[], None],
    ) -> None:
        self.bridge = ShellIpcBridge()
        self.bridge.start_requested.connect(on_start)
        self.bridge.stop_requested.connect(on_stop)
        self.bridge.toggle_requested.connect(on_toggle)
        self.bridge.show_panel_requested.connect(on_show_panel)
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._server is not None:
            return

        bridge = self.bridge

        class RequestHandler(BaseHTTPRequestHandler):
            def _write_json(self, status_code: int, payload: dict) -> None:
                response = json.dumps(payload).encode("utf-8")
                self.send_response(status_code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)

            def log_message(self, _format: str, *_args) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802
                if self.path == "/health":
                    self._write_json(
                        HTTPStatus.OK,
                        {
                            "ok": True,
                            "service": "qt_shell_ipc",
                        },
                    )
                    return

                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

            def do_POST(self) -> None:  # noqa: N802
                if self.path == "/push-to-talk/start":
                    bridge.start_requested.emit()
                elif self.path == "/push-to-talk/stop":
                    bridge.stop_requested.emit()
                elif self.path == "/push-to-talk/toggle":
                    bridge.toggle_requested.emit()
                elif self.path == "/show-control-panel":
                    bridge.show_panel_requested.emit()
                else:
                    self._write_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                    return

                self._write_json(HTTPStatus.OK, {"ok": True})

        self._server = ThreadingHTTPServer((IPC_HOST, IPC_PORT), RequestHandler)
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="qt-shell-ipc",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        if self._server is None:
            return

        self._server.shutdown()
        self._server.server_close()
        self._server = None
        self._thread = None

    def get_state(self) -> ShellIpcServerState:
        return ShellIpcServerState(
            host=IPC_HOST,
            port=IPC_PORT,
            is_running=self._server is not None,
        )
