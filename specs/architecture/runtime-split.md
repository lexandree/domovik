# Runtime Split

## Status

Draft

## Decision Shape

Zippy should be split into two layers:

1. `core runtime`
2. `linux desktop shell`

## Core Runtime Responsibilities

- environment loading
- Anthropic requests
- ElevenLabs TTS/STT integration
- local Whisper execution
- Codex / Claude Code / OpenClaw handoffs
- conversation logic
- trigger normalization and parsing
- persistent settings and local logs

## Linux Desktop Shell Responsibilities

- tray icon and menu
- transparent overlay windows
- cursor-following companion presentation
- global push-to-talk registration
- microphone device capture
- screen capture
- native notifications
- window lifecycle

## Why Split It

- The current Node runtime already contains useful non-UI logic.
- Native desktop features have different failure modes than API orchestration.
- Keeping the core separate lowers the cost of future shell rewrites.
- Tests for voice trigger parsing and agent orchestration should not depend on GUI code.

## Consequence

The current browser UI should be treated as a temporary debug surface, not the final Linux shell.

