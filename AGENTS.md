# Domovik - Agent Instructions

`CLAUDE.md` points to this file.

## Overview

This repository is the standalone Linux port of the Domovik local desktop companion project.

The repository now consists of:

- a `core runtime` in Node.js
- an emerging native Linux shell in Python/Qt

The current runtime:

- reads API secrets from `linux/.env`
- serves a local browser UI from `linux/public/`
- captures screenshots through browser screen sharing or manual image upload
- records microphone audio in the browser
- transcribes audio with ElevenLabs speech-to-text or a local Whisper install
- calls Anthropic directly for screenshot + vision chat
- calls ElevenLabs directly for text-to-speech
- can route one-shot requests to a local Codex CLI run when the prompt starts with a supported German, English, or Russian trigger for Codex
- can route one-shot requests to a local Claude Code CLI run when the prompt starts with a supported German, English, or Russian trigger for Claude Code
- can route one-shot requests to a local OpenClaw CLI run when the prompt starts with a supported German, English, or Russian trigger for OpenClaw
- can attach the current browser screenshot to Codex runs for prompts like `nimm codex mit screen`, `use codex with screenshot`, or `запусти codex со скриншотом`
- uses `playground/` in the repo root as the default Codex working directory
- writes run logs to `codex output/`
- stores non-secret local temp state in `linux/data/`

The native Linux shell scaffold:

- lives in `linux/qt_shell/`
- is built with Python and PySide6
- owns tray, overlay, runtime bridge, and future desktop-native behaviours
- should absorb native Linux integration concerns instead of pushing them into the browser UI

The repository also contains a GNOME-specific shortcut adapter:

- `linux/gnome_extension/`
- used only for GNOME Shell integration where a desktop-specific trigger layer is needed
- should remain a thin adapter over the Qt shell, not a second runtime

## Key Files

| File | Purpose |
|------|---------|
| `linux/server.js` | Main Linux backend. Hosts HTTP routes, Anthropic requests, ElevenLabs STT/TTS, Whisper runs, and CLI handoffs. |
| `linux/public/index.html` | Main browser UI. |
| `linux/public/app.js` | Browser-side screenshot capture, microphone recording, chat requests, and response playback. |
| `linux/public/styles.css` | Linux UI styling. |
| `linux/qt_shell/app.py` | Native Qt shell entry point. |
| `linux/qt_shell/tray.py` | Tray icon controller for the native shell. |
| `linux/qt_shell/overlay.py` | Transparent overlay companion window scaffold. |
| `linux/qt_shell/bridge.py` | Runtime bridge from Qt shell to the Node runtime. |
| `linux/gnome_extension/` | GNOME Shell extension scaffold for GNOME-specific shortcut integration. |
| `requirements-desktop.txt` | Python dependencies for the native shell. |
| `linux/.env.example` | Template for local API secrets and command paths. |
| `linux/README.md` | Linux runtime setup notes. |
| `README.md` | English project overview for the standalone Linux port. |
| `README.ru.md` | Russian project overview. |
| `AGENTS.ru.md` | Russian version of these agent instructions. |
| `SOUL.md` | Editable personality layer for the assistant prompt. |
| `NOTICE.md` | Provenance and attribution note. |
| `.gitignore` | Ignores local secrets, generated state, and runtime artifacts. |

## Build & Run

```bash
cp linux/.env.example linux/.env
npm run start:linux
```

Then open `http://127.0.0.1:3000`.

Planned native shell launch:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-desktop.txt
python3 -m linux.qt_shell.app
```

## Conventions

- Keep the repo focused on the Linux local web app only.
- Do not reintroduce Windows WinForms, macOS AppKit/SwiftUI, Xcode, or Cloudflare Worker code unless the user explicitly asks for it.
- Keep secrets out of source files. Use `linux/.env`.
- Keep generated local state in `linux/data/`.
- Keep `playground/` out of git.
- Keep `codex output/` out of git.
- Keep runtime logic dependency-light. The current Linux runtime intentionally uses Node built-ins only.
- Preserve German trigger phrases unless the user asks to change them.
- Keep English and Russian trigger support aligned with the shared normalization layer in `linux/server.js`.
- Treat `specs/` as the source of truth for product scope and architecture direction when the project grows.
- Keep native Linux desktop integration work in `linux/qt_shell/` unless there is a clear reason to move it elsewhere.
- GNOME Shell extension code belongs in `linux/gnome_extension/` and should stay a thin trigger adapter over the Qt shell.

## Verification

When changing the Linux runtime materially, prefer this verification sequence:

1. `node --check linux/server.js`
2. `node --check linux/public/app.js`
3. `npm run start:linux`
4. `curl -s http://127.0.0.1:3000/health`
5. `curl -s http://127.0.0.1:3000/api/status`

## Self-Update

When the Linux app structure changes materially, update this file.

## Active Technologies
- Node.js >=20 for runtime, browser JavaScript for web UI, Python 3.11+ for Qt shell + Node built-ins only in `linux/server.js`, PySide6 shell, existing MiniMax/OpenAI-compatible/Anthropic HTTP integrations, existing GNOME Shell extension adapter (003-agentic-vision-runtime)
- local files only: `linux/.env`, `linux/data/`, `codex output/`, in-memory conversation and visual session state in runtime/UI (003-agentic-vision-runtime)

## Recent Changes
- 003-agentic-vision-runtime: Added Node.js >=20 for runtime, browser JavaScript for web UI, Python 3.11+ for Qt shell + Node built-ins only in `linux/server.js`, PySide6 shell, existing MiniMax/OpenAI-compatible/Anthropic HTTP integrations, existing GNOME Shell extension adapter
