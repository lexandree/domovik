# Domovik For Linux

This Linux version currently consists of two layers:

- a local Node.js runtime core
- an early native Qt/PySide6 shell scaffold for Linux

## What Works

- local browser client on `127.0.0.1`
- first native Qt shell scaffold in `linux/qt_shell/`
- control panel for overlay and runtime control
- native screenshot capture from the Qt shell control panel
- direct runtime requests from the Qt shell control panel
- browser screen capture or manual image upload
- text-only prompts sent through a dedicated text backend
- screenshot-aware prompts sent through a dedicated vision backend
- voice input through the browser microphone, transcribed with ElevenLabs, local Whisper, or a Sherpa-ONNX websocket server
- ElevenLabs or MiniMax TTS for replies
- one-shot handoffs to `codex`, `claude`, and `openclaw`
- logs written to `codex output/`

## What Is Not Yet Ported To Linux

- a fully functional cursor companion overlay
- true hold/release global push-to-talk hotkeys on all Wayland desktops
- mature tray handling across desktop environments
- Windows-specific cursor navigation and screen detection

## Start: Runtime Today

1. `cp linux/.env.example linux/.env`
2. `npm run start:linux`
3. open `http://127.0.0.1:3000` in a browser

## Start: Native Shell Scaffold

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-desktop.txt
python3 -m linux.qt_shell.app
```

The Qt shell scaffold talks to the existing runtime core through the local status/API path.
The launcher automatically disables `libqgtk3.so` in the active Python environment to avoid the `qgtk3` crash observed on Ubuntu GNOME.
On startup, the shell opens a control panel and can show the local runtime process model and start or stop the runtime core.
The control panel can also capture the current screen natively and send a prompt with screenshot directly to the runtime core.
The current Sherpa-ONNX STT integration is the recommended STT path for native WAV capture flows such as the Qt shell push-to-talk path. It is not the right default for the browser `MediaRecorder` path unless that path is converted to WAV first.
The shell now probes the desktop session for a real hotkey backend and shows that status in the control panel. On the tested Ubuntu 24.04 GNOME 46 Wayland machine, `org.freedesktop.portal.GlobalShortcuts` is not exposed by the active portal stack, so the shell currently runs in manual/tray push-to-talk fallback mode instead of pretending a real hold/release global shortcut exists.
This repo now also includes a GNOME Shell extension backend in `linux/gnome_extension/`. On GNOME 46 it provides a practical **toggle** shortcut backend for the Qt shell over localhost IPC. It is GNOME-specific and should be treated as a separate adapter, not as a general Linux solution.

## Configuration

The relevant variables are listed in `linux/.env.example`.

- `VISION_PROVIDER`: `anthropic` or `openai_compat`
- `TEXT_PROVIDER`: `vision_provider` or `minimax`
- `ANTHROPIC_API_KEY`: primary LLM with screenshot understanding when `VISION_PROVIDER=anthropic`
- `ANTHROPIC_MODEL`: default `claude-sonnet-4-20250514`
- `OPENAI_COMPAT_BASE_URL`: base URL of an OpenAI-compatible vision backend, for example your Cloudflare tunnel to Kaggle
- `OPENAI_COMPAT_API_KEY`: API key for the OpenAI-compatible backend; often `EMPTY` for your own `vLLM`
- `OPENAI_COMPAT_MODEL`: model name for the OpenAI-compatible backend
- `OPENAI_COMPAT_CF_ACCESS_CLIENT_ID`, `OPENAI_COMPAT_CF_ACCESS_CLIENT_SECRET`: optional for Cloudflare Access-protected endpoints
- `MINIMAX_TEXT_BASE_URL`: default `https://api.minimax.io/v1`
- `MINIMAX_TEXT_MODEL`: default `MiniMax-M2.7`
- `TTS_PROVIDER`: `elevenlabs` or `minimax`
- `ELEVENLABS_API_KEY`: TTS and optionally STT
- `ELEVENLABS_VOICE_ID`: selected voice
- `ELEVENLABS_STT_KEYTERMS`: optional keyterms to improve STT recognition of command words like `Codex`, `Claude Code`, `OpenClaw`
- `MINIMAX_API_KEY`: shared MiniMax API key for speech requests
- `MINIMAX_TTS_URL`: MiniMax TTS HTTP endpoint, default `https://api.minimax.io/v1/t2a_v2`
- `MINIMAX_TTS_MODEL`: MiniMax speech model, for example `speech-2.8-turbo`
- `MINIMAX_VOICE_ID`: MiniMax system or cloned voice ID
- `MINIMAX_VOICE_SPEED`, `MINIMAX_VOICE_VOLUME`, `MINIMAX_VOICE_PITCH`: optional MiniMax voice controls
- `MINIMAX_AUDIO_SAMPLE_RATE`, `MINIMAX_AUDIO_BITRATE`: optional MiniMax audio output settings
- `STT_PROVIDER`: `sherpa_onnx` is the recommended native-shell default; `elevenlabs` or `whisper` remain available as fallbacks
- `WHISPER_*`: only needed for local Whisper
- `SHERPA_ONNX_SERVER_ADDR`, `SHERPA_ONNX_SERVER_PORT`: websocket server address for Sherpa-ONNX offline transcription
- `SHERPA_ONNX_SAMPLE_RATE`: expected WAV sample rate for Sherpa-ONNX, default `16000`
- `SHERPA_ONNX_CHUNK_BYTES`: websocket send chunk size, default `10240`
- `SHERPA_ONNX_TIMEOUT_SECONDS`: timeout for one Sherpa-ONNX transcription request
- `CODEX_COMMAND`, `CLAUDE_CODE_COMMAND`, `OPENCLAW_COMMAND`: local CLI binaries
- `CODEX_WORKDIR`: target directory for agent runs, default `../playground`
- `OPENCLAW_GATEWAY_URL`, `GATEWAY_TOKEN`: only for OpenClaw

## External Sherpa-ONNX Workspace

The recommended native-shell STT path currently uses an external Sherpa-ONNX workspace under `~/stt` with a separate Conda environment named `stt`.

Build and run notes for that external setup are documented in:

- [`linux/STT.md`](./STT.md)

## Text vs Vision Routing

The runtime now routes text-only and screenshot-aware turns separately:

- text-only turns can go to `TEXT_PROVIDER=minimax`
- screenshot-aware turns go to `VISION_PROVIDER`

If a screenshot is attached but the configured vision backend is unavailable, the runtime returns a normal assistant reply that tells the user to switch to text-only mode instead of failing with a hard error.

## Handoffs

- `nimm codex ...`
- `nimm codex mit screen ...`
- `use codex ...`
- `run codex with screenshot ...`
- `запусти codex ...`
- `передай openclaw ...`
- `nimm claude code ...`
- `nimm openclaw ...`

`nimm codex mit screen ...` saves the currently captured browser screenshot temporarily to `codex output/screen captures/` and attaches it to the run.

## Native Shell Files

- `linux/qt_shell/app.py`
- `linux/qt_shell/tray.py`
- `linux/qt_shell/overlay.py`
- `linux/qt_shell/bridge.py`
- `linux/qt_shell/settings.py`
