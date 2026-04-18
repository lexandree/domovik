from __future__ import annotations

from collections.abc import Callable
import threading

from PySide6.QtCore import QObject, Signal


class AsyncCallSignals(QObject):
    succeeded = Signal(object)
    failed = Signal(str)
    finished = Signal()


class AsyncCall:
    def __init__(self, fn: Callable, *args, **kwargs) -> None:
        self._fn = fn
        self._args = args
        self._kwargs = kwargs
        self.signals = AsyncCallSignals()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return

        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            result = self._fn(*self._args, **self._kwargs)
        except Exception as exc:
            self.signals.failed.emit(str(exc))
        else:
            self.signals.succeeded.emit(result)
        finally:
            self.signals.finished.emit()
