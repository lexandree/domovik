# Zippy Linux - Agent Instructions

`CLAUDE.md` points to this file.

## Overview

This repository is the standalone Linux port of Zippy.

The app is a local Node.js + browser runtime that:

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

## Key Files

| File | Purpose |
|------|---------|
| `linux/server.js` | Main Linux backend. Hosts HTTP routes, Anthropic requests, ElevenLabs STT/TTS, Whisper runs, and CLI handoffs. |
| `linux/public/index.html` | Main browser UI. |
| `linux/public/app.js` | Browser-side screenshot capture, microphone recording, chat requests, and response playback. |
| `linux/public/styles.css` | Linux UI styling. |
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

## Verification

When changing the Linux runtime materially, prefer this verification sequence:

1. `node --check linux/server.js`
2. `node --check linux/public/app.js`
3. `npm run start:linux`
4. `curl -s http://127.0.0.1:3000/health`
5. `curl -s http://127.0.0.1:3000/api/status`

## Self-Update

When the Linux app structure changes materially, update this file.
