from __future__ import annotations

import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import time
from typing import Any
from urllib import request, error


MODEL_ID = os.environ.get("VLLM_MODEL_ID", "Qwen/Qwen2.5-VL-7B-Instruct")
HOST = os.environ.get("VLLM_HOST", "127.0.0.1")
PORT = int(os.environ.get("VLLM_PORT", "8000"))
TENSOR_PARALLEL_SIZE = int(os.environ.get("VLLM_TENSOR_PARALLEL_SIZE", "2"))
DTYPE = os.environ.get("VLLM_DTYPE", "half")
ATTENTION_BACKEND = os.environ.get("VLLM_ATTENTION_BACKEND", "TRITON_ATTN")
MAX_MODEL_LEN = int(os.environ.get("VLLM_MAX_MODEL_LEN", "4096"))
GPU_MEMORY_UTILIZATION = os.environ.get("VLLM_GPU_MEMORY_UTILIZATION", "0.92")
MM_LIMIT = os.environ.get("VLLM_LIMIT_MM_PER_PROMPT", '{"image":1,"video":0}')
WORK_ROOT = Path(os.environ.get("VLLM_WORK_ROOT", "/kaggle/working/vllm_server"))
LOG_FILE = WORK_ROOT / "vllm.log"
PID_FILE = WORK_ROOT / "vllm.pid"
TEST_IMAGE_URL = os.environ.get(
    "VLLM_TEST_IMAGE_URL",
    "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg",
)
TUNNEL_HOSTNAME = os.environ.get("CLOUDFLARE_TUNNEL_HOSTNAME", "")
CLOUDFLARE_TUNNEL_TOKEN = os.environ.get("CLOUDFLARE_TUNNEL_TOKEN", "")
CLOUDFLARED_URL = os.environ.get(
    "CLOUDFLARED_URL",
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
)
CLOUDFLARED_BIN = os.environ.get("CLOUDFLARED_BIN", "")
CLOUDFLARED_LOG_FILE = WORK_ROOT / "cloudflared.log"
CLOUDFLARED_PID_FILE = WORK_ROOT / "cloudflared.pid"
STARTUP_TIMEOUT_SECONDS = int(os.environ.get("VLLM_STARTUP_TIMEOUT_SECONDS", "240"))
STARTUP_MARKERS = [
    ("process_started", "process started"),
    ("engine_init", "Initializing a V1 LLM engine"),
    ("workers_ready", "distributed_init_method="),
    ("weights_loading", "Loading safetensors checkpoint shards"),
    ("weights_loaded", "Loading weights took"),
    ("compile_cache", "torch.compile took"),
    ("graph_register", "Registering 112 cuda graph addresses"),
]
ERROR_MARKERS = [
    "RuntimeError:",
    "ValueError:",
    "CalledProcessError",
    "Ninja build failed",
    "cannot find -lcuda",
    "WorkerProc failed to start",
]
TRYCLOUDFLARE_PATTERN = re.compile(r"https://[a-zA-Z0-9.-]+\.trycloudflare\.com")


def ensure_work_root() -> None:
    WORK_ROOT.mkdir(parents=True, exist_ok=True)


def is_port_open(host: str, port: int, timeout: float = 1.0) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def read_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def read_cloudflared_pid() -> int | None:
    if not CLOUDFLARED_PID_FILE.exists():
        return None
    try:
        return int(CLOUDFLARED_PID_FILE.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def process_exists(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def tail_log(line_count: int = 120) -> str:
    if not LOG_FILE.exists():
        return ""
    lines = LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
    return "\n".join(lines[-line_count:])


def tail_cloudflared_log(line_count: int = 120) -> str:
    if not CLOUDFLARED_LOG_FILE.exists():
        return ""
    lines = CLOUDFLARED_LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()
    return "\n".join(lines[-line_count:])


def read_log_lines() -> list[str]:
    if not LOG_FILE.exists():
        return []
    return LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()


def resolve_cloudflared_bin() -> Path:
    explicit = Path(CLOUDFLARED_BIN) if CLOUDFLARED_BIN else None
    if explicit and explicit.exists():
        return explicit

    system_bin = shutil.which("cloudflared")
    if system_bin:
        return Path(system_bin)

    return download_cloudflared()


def download_cloudflared() -> Path:
    ensure_work_root()
    local_bin = WORK_ROOT / "cloudflared"
    if local_bin.exists():
        return local_bin
    request.urlretrieve(CLOUDFLARED_URL, local_bin)
    local_bin.chmod(0o755)
    return local_bin


def summarize_startup_progress(lines: list[str]) -> dict[str, Any]:
    matched: list[str] = []
    last_stage = "waiting for first log line"
    joined = "\n".join(lines)

    if lines:
        last_stage = "process started"

    for stage_id, marker in STARTUP_MARKERS[1:]:
        if marker in joined:
            matched.append(stage_id)
            last_stage = stage_id.replace("_", " ")

    errors = [marker for marker in ERROR_MARKERS if marker in joined]
    return {
        "last_stage": last_stage,
        "matched_stages": matched,
        "errors": errors,
    }


def build_server_command() -> list[str]:
    return [
        "vllm",
        "serve",
        MODEL_ID,
        "--host",
        HOST,
        "--port",
        str(PORT),
        "--tensor-parallel-size",
        str(TENSOR_PARALLEL_SIZE),
        "--dtype",
        DTYPE,
        "--attention-backend",
        ATTENTION_BACKEND,
        "--max-model-len",
        str(MAX_MODEL_LEN),
        "--gpu-memory-utilization",
        str(GPU_MEMORY_UTILIZATION),
        "--limit-mm-per-prompt",
        MM_LIMIT,
    ]


def build_cloudflared_command() -> list[str]:
    binary = resolve_cloudflared_bin()
    if not CLOUDFLARE_TUNNEL_TOKEN:
        return [
            str(binary),
            "tunnel",
            "--url",
            f"http://localhost:{PORT}",
        ]
    return [
        str(binary),
        "tunnel",
        "run",
        "--token",
        CLOUDFLARE_TUNNEL_TOKEN,
    ]


def start_server() -> subprocess.Popen[str]:
    ensure_work_root()

    existing_pid = read_pid()
    if existing_pid and process_exists(existing_pid):
        raise RuntimeError(f"Server already running with pid {existing_pid}")

    log_handle = open(LOG_FILE, "w", encoding="utf-8")
    process = subprocess.Popen(
        build_server_command(),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        text=True,
    )
    PID_FILE.write_text(str(process.pid), encoding="utf-8")
    return process


def stop_server() -> None:
    pid = read_pid()
    if pid is None:
        print("No pid file; nothing to stop.")
        return

    if not process_exists(pid):
        PID_FILE.unlink(missing_ok=True)
        print("Pid file removed; process already gone.")
        return

    os.killpg(os.getpgid(pid), signal.SIGTERM)
    deadline = time.time() + 20
    while time.time() < deadline:
        if not process_exists(pid):
            PID_FILE.unlink(missing_ok=True)
            print("Server stopped cleanly.")
            return
        time.sleep(0.5)

    os.killpg(os.getpgid(pid), signal.SIGKILL)
    PID_FILE.unlink(missing_ok=True)
    print("Server force-killed.")


def start_cloudflared() -> subprocess.Popen[str]:
    ensure_work_root()

    existing_pid = read_cloudflared_pid()
    if existing_pid and process_exists(existing_pid):
        raise RuntimeError(f"cloudflared already running with pid {existing_pid}")

    log_handle = open(CLOUDFLARED_LOG_FILE, "w", encoding="utf-8")
    process = subprocess.Popen(
        build_cloudflared_command(),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        text=True,
    )
    CLOUDFLARED_PID_FILE.write_text(str(process.pid), encoding="utf-8")
    return process


def stop_cloudflared() -> None:
    pid = read_cloudflared_pid()
    if pid is None:
        print("No cloudflared pid file; nothing to stop.")
        return

    if not process_exists(pid):
        CLOUDFLARED_PID_FILE.unlink(missing_ok=True)
        print("cloudflared pid file removed; process already gone.")
        return

    os.killpg(os.getpgid(pid), signal.SIGTERM)
    deadline = time.time() + 20
    while time.time() < deadline:
        if not process_exists(pid):
            CLOUDFLARED_PID_FILE.unlink(missing_ok=True)
            print("cloudflared stopped cleanly.")
            return
        time.sleep(0.5)

    os.killpg(os.getpgid(pid), signal.SIGKILL)
    CLOUDFLARED_PID_FILE.unlink(missing_ok=True)
    print("cloudflared force-killed.")


def server_models() -> dict[str, Any] | None:
    try:
        with request.urlopen(f"http://{HOST}:{PORT}/v1/models", timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return None


def wait_for_server(timeout_s: int = STARTUP_TIMEOUT_SECONDS) -> bool:
    deadline = time.time() + timeout_s
    last_reported_stage = None
    last_reported_errors: tuple[str, ...] = ()
    while time.time() < deadline:
        models = server_models()
        if is_port_open(HOST, PORT) and models is not None:
            return True

        progress = summarize_startup_progress(read_log_lines())
        stage = progress["last_stage"]
        errors = tuple(progress["errors"])
        if stage != last_reported_stage or errors != last_reported_errors:
            print(
                json.dumps(
                    {
                        "ready": False,
                        "stage": stage,
                        "errors": list(errors),
                    },
                    ensure_ascii=False,
                )
            )
            last_reported_stage = stage
            last_reported_errors = errors
        time.sleep(2)
    return False


def restart_server() -> subprocess.Popen[str]:
    stop_server()
    return start_server()


def restart_cloudflared() -> subprocess.Popen[str]:
    stop_cloudflared()
    return start_cloudflared()


def discover_tunnel_url(log_text: str) -> str:
    if TUNNEL_HOSTNAME:
        return f"https://{TUNNEL_HOSTNAME}"
    match = TRYCLOUDFLARE_PATTERN.search(log_text)
    return match.group(0) if match else ""


def health_summary() -> dict[str, Any]:
    models = server_models()
    progress = summarize_startup_progress(read_log_lines())
    return {
        "ready": models is not None,
        "startup_stage": progress["last_stage"],
        "startup_errors": progress["errors"],
        "port_open": is_port_open(HOST, PORT),
        "models": models,
        "pid": read_pid(),
        "log_tail": tail_log(80),
    }


def tunnel_summary() -> dict[str, Any]:
    pid = read_cloudflared_pid()
    log_tail = tail_cloudflared_log(80)
    public_url = discover_tunnel_url(log_tail)
    return {
        "pid": pid,
        "mode": "token" if CLOUDFLARE_TUNNEL_TOKEN else "quick",
        "hostname": TUNNEL_HOSTNAME or public_url.removeprefix("https://"),
        "public_url": public_url,
        "cloudflared_bin": str(resolve_cloudflared_bin()),
        "running": bool(pid and process_exists(pid)),
        "log_tail": log_tail,
    }


def start_server_and_wait(timeout_s: int = STARTUP_TIMEOUT_SECONDS) -> dict[str, Any]:
    process = start_server()
    ready = wait_for_server(timeout_s)
    summary = health_summary()
    summary["started_pid"] = process.pid
    summary["ready"] = ready and summary["models"] is not None
    return summary


if __name__ == "__main__":
    print("This file is intended to be copied into a Kaggle notebook cell or imported there.")
    print("Example:")
    print("  summary = start_server_and_wait()")
    print("  print(json.dumps(health_summary(), indent=2)[:2000])")
