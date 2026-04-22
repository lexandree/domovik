# Domovik

Domovik is a local-first desktop companion for Linux and Ubuntu.

This repository is the standalone Linux port extracted from two predecessor projects:

- `farzaa/clicky` for the original cursor-companion concept
- `Arnie936/zippy-windows` for the local-first agent orchestration, direct API usage, and German trigger workflow

The current build runs as a local Node.js runtime with a browser UI today, and now also includes the first native Qt/PySide6 Linux shell scaffold for restoring tray, overlay, and desktop-native workflows.

The handoff parser keeps the German trigger phrases from `zippy-windows` and additionally supports English and Russian trigger forms, including common speech-recognition mistakes.

## Features

- local browser UI on `127.0.0.1`
- native Qt/PySide6 shell scaffold in `linux/qt_shell/`
- screenshot capture through browser screen sharing or manual image upload
- microphone recording in the browser
- dedicated text-only chat through MiniMax or the shared vision backend
- Anthropic or OpenAI-compatible screenshot + vision chat with your own endpoint and keys
- ElevenLabs text-to-speech
- speech-to-text through Sherpa-ONNX for the native shell, with ElevenLabs and local Whisper still available as fallbacks
- a GNOME-specific shortcut adapter for the Qt shell under `linux/gnome_extension/`
- one-shot handoffs to Codex, Claude Code, and OpenClaw
- local run logs in `codex output/`
- editable personality prompt in [`SOUL.md`](SOUL.md)

## Quick Start

1. Clone this repository.
2. Copy the example environment file:

```bash
cp linux/.env.example linux/.env
```

3. Fill in your API keys and command paths in `linux/.env`.
4. Start the local server:

```bash
npm run start:linux
```

5. Open:

```text
http://127.0.0.1:3000
```

## Native Shell Direction

The browser UI is now treated as a temporary debug surface. The main growth path is a native Linux shell built with Qt and PySide6.

Current native-shell scaffold:

- [`linux/qt_shell/app.py`](linux/qt_shell/app.py)
- [`linux/qt_shell/tray.py`](linux/qt_shell/tray.py)
- [`linux/qt_shell/overlay.py`](linux/qt_shell/overlay.py)
- [`linux/qt_shell/bridge.py`](linux/qt_shell/bridge.py)
- [`linux/qt_shell/panel.py`](linux/qt_shell/panel.py)
- [`linux/qt_shell/runtime.py`](linux/qt_shell/runtime.py)
- [`requirements-desktop.txt`](requirements-desktop.txt)

Planned local setup:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-desktop.txt
python3 -m linux.qt_shell.app
```

The Qt shell now includes a bootstrap workaround for the Ubuntu GNOME `qgtk3` platform-theme crash by disabling `libqgtk3.so` in the active environment, and it should be launched from `.venv-qt`.
It also now opens a native control panel for overlay visibility and runtime lifecycle management.
The control panel can also capture the current screen natively and send screenshot-aware prompts to the runtime without using the browser UI.
The preferred STT path for the native shell is now a local Sherpa-ONNX websocket server fed by native WAV capture from the Qt shell.

## Required Keys

- one configured text or vision backend:
  - `MINIMAX_API_KEY` for `TEXT_PROVIDER=minimax`
  - or `ANTHROPIC_API_KEY` for `VISION_PROVIDER=anthropic`
  - or your own OpenAI-compatible endpoint plus key/token for `VISION_PROVIDER=openai_compat`
- one TTS backend:
  - `MINIMAX_API_KEY` + `MINIMAX_VOICE_ID`
  - or `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`

## Optional Local Tools

- local Whisper via `python3 -m whisper`
- local Codex CLI for `nimm codex ...`
- local Claude Code CLI for `nimm claude code ...`
- local OpenClaw CLI for `nimm openclaw ...`

## Architecture

The Linux port deliberately does not try to keep the Windows WinForms shell alive on Ubuntu. Instead it replaces the platform-specific shell with a Linux-safe local web runtime:

- `linux/server.js` hosts the local HTTP server and API routes
- `linux/public/` contains the browser UI
- `linux/.env` holds your local configuration
- `linux/prompts.json` holds runtime/system prompt templates
- `SOUL.md` defines the assistant personality prompt
- `codex output/` stores handoff logs and optional screenshot attachments

## Project Layout

```text
linux/
  server.js
  .env.example
  README.md
  public/
SOUL.md
LICENSE
NOTICE.md
```

## Trigger Phrases

- `nimm codex ...`
- `nimm codex mit screen ...`
- `use codex ...`
- `run codex with screenshot ...`
- `запусти codex ...`
- `передай openclaw ...`
- `nimm claude code ...`
- `nimm openclaw ...`

## Current Limitations

- no tray icon yet
- no compositor-agnostic true hold/release global push-to-talk hotkey yet
- no always-on cursor overlay yet
- no animated `[POINT:...]` cursor navigation yet
- speech and vision features depend on external API availability

## Documentation

- English runtime notes: [`linux/README.md`](linux/README.md)
- Sherpa-ONNX STT setup notes: [`linux/STT.md`](linux/STT.md)
- English agent instructions: [`AGENTS.md`](AGENTS.md)
- Russian overview: [`README.ru.md`](README.ru.md)
- Russian agent instructions: [`AGENTS.ru.md`](AGENTS.ru.md)
- Specs and architecture notes: [`specs/README.md`](specs/README.md)
- Qt shell feature spec: [`specs/001-qt-linux-shell/spec.md`](specs/001-qt-linux-shell/spec.md)

## License

MIT. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
