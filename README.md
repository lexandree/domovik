# Zippy For Linux

Zippy is a local-first desktop assistant for Linux and Ubuntu.

This repository is the standalone Linux port extracted from two predecessor projects:

- `farzaa/clicky` for the original cursor-companion concept
- `Arnie936/zippy-windows` for the local-first agent orchestration, direct API usage, and German trigger workflow

The current build runs as a local Node.js server with a browser UI. It can capture a screenshot, record your microphone, talk to Claude with image context, synthesize speech through ElevenLabs, and hand off one-shot tasks to local `codex`, `claude`, and `openclaw` CLIs.

The handoff parser keeps the German trigger phrases from `zippy-windows` and additionally supports English and Russian trigger forms, including common speech-recognition mistakes.

## Features

- local browser UI on `127.0.0.1`
- screenshot capture through browser screen sharing or manual image upload
- microphone recording in the browser
- Anthropic screenshot + vision chat with your own API key
- ElevenLabs text-to-speech
- speech-to-text through ElevenLabs or local Whisper
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

## Required Keys

- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

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
- no global push-to-talk hotkey yet
- no always-on cursor overlay yet
- no animated `[POINT:...]` cursor navigation yet
- speech and vision features depend on external API availability

## Documentation

- English runtime notes: [`linux/README.md`](linux/README.md)
- English agent instructions: [`AGENTS.md`](AGENTS.md)
- Russian overview: [`README.ru.md`](README.ru.md)
- Russian agent instructions: [`AGENTS.ru.md`](AGENTS.ru.md)
- Specs and architecture notes: [`specs/README.md`](specs/README.md)

## License

MIT. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
