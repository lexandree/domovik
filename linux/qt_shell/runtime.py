from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os
import subprocess
import signal
import getpass


@dataclass
class RuntimeProcessState:
    is_running: bool
    pid: int | None
    is_managed_by_shell: bool


class RuntimeProcessController:
    def __init__(self) -> None:
        self._process: subprocess.Popen[str] | None = None

    def start(self) -> RuntimeProcessState:
        if self._process and self._process.poll() is None:
            return self.get_state()

        repository_root = Path(__file__).resolve().parents[2]
        shell_environment = os.environ.copy()
        shell_environment.setdefault("PATH", os.environ.get("PATH", ""))

        self._process = subprocess.Popen(
            ["npm", "run", "start:linux"],
            cwd=repository_root,
            env=shell_environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            text=True,
        )
        return self.get_state()

    def stop(self) -> RuntimeProcessState:
        if self._process and self._process.poll() is None:
            self._terminate_process_group(self._process.pid)
            self._process = None
            return self.get_state()

        external_runtime_processes = self._find_external_runtime_processes()
        if external_runtime_processes:
            self._terminate_external_runtime_processes(external_runtime_processes)
            return self.get_state()

        self._process = None
        return self.get_state()

    def stop_managed_runtime(self) -> RuntimeProcessState:
        if self._process and self._process.poll() is None:
            self._terminate_process_group(self._process.pid)
            self._process = None
        return self.get_state()

    def get_state(self) -> RuntimeProcessState:
        if self._process and self._process.poll() is None:
            return RuntimeProcessState(
                is_running=True,
                pid=self._process.pid,
                is_managed_by_shell=True,
            )

        external_runtime_processes = self._find_external_runtime_processes()
        if external_runtime_processes:
            return RuntimeProcessState(
                is_running=True,
                pid=external_runtime_processes[0].pid,
                is_managed_by_shell=False,
            )

        return RuntimeProcessState(is_running=False, pid=None, is_managed_by_shell=False)

    def _find_external_runtime_processes(self) -> list["ProcessEntry"]:
        current_username = getpass.getuser()
        process_listing = subprocess.run(
            ["ps", "-eo", "pid=,ppid=,user=,args="],
            check=False,
            capture_output=True,
            text=True,
        )

        if process_listing.returncode != 0:
            return []

        matched_processes: list[ProcessEntry] = []
        for raw_line in process_listing.stdout.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            parts = line.split(maxsplit=3)
            if len(parts) != 4:
                continue

            pid_text, ppid_text, username, command_text = parts
            if not pid_text.isdigit() or not ppid_text.isdigit():
                continue

            if username != current_username:
                continue

            if (
                "node linux/server.js" in command_text
                or "sh -c node linux/server.js" in command_text
                or "npm run start:linux" in command_text
            ):
                matched_processes.append(
                    ProcessEntry(
                        pid=int(pid_text),
                        ppid=int(ppid_text),
                        command=command_text,
                    )
                )

        matched_processes.sort(key=lambda process_entry: process_entry.pid, reverse=True)
        return matched_processes

    def _terminate_process_group(self, pid: int) -> None:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except ProcessLookupError:
            return

        try:
            if self._process and self._process.pid == pid:
                self._process.wait(timeout=5)
                return
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except ProcessLookupError:
                pass

    def _terminate_external_runtime_processes(self, process_entries: list["ProcessEntry"]) -> None:
        for process_entry in process_entries:
            self._terminate_pid(process_entry.pid, signal.SIGTERM)

        for process_entry in process_entries:
            if self._pid_exists(process_entry.pid):
                self._terminate_pid(process_entry.pid, signal.SIGKILL)

    def _terminate_pid(self, pid: int, termination_signal: signal.Signals) -> None:
        try:
            os.kill(pid, termination_signal)
        except ProcessLookupError:
            return

    def _pid_exists(self, pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True


@dataclass
class ProcessEntry:
    pid: int
    ppid: int
    command: str
