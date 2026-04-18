# Linux Desktop Vision

## Status

Draft

## Goal

Turn Domovik into a Linux desktop assistant that recovers the defining native behaviours of the original macOS and Windows apps:

- tray-resident app
- always-available companion near the cursor
- global push-to-talk
- screenshot-aware assistant flow
- local agent handoffs to Codex, Claude Code, and OpenClaw

## Non-Goals

- shipping a generic cross-platform shell first
- optimizing for the smallest possible binary before native behaviours exist
- reproducing every visual detail of the original apps before core interaction quality is stable

## Product Principles

- Native behaviours matter more than web portability.
- Local-first operation matters more than cloud orchestration convenience.
- Voice and screenshot workflows should take priority over settings polish.
- Linux support should target real desktop usage, not only a browser tab.

## Must-Have Behaviours

1. Tray icon with quick actions.
2. Transparent always-on-top companion window.
3. Global push-to-talk hotkey that works while the app is backgrounded.
4. Microphone capture and transcription.
5. Screen capture without relying on a manually shared browser tab.
6. Assistant responses shown in the companion UI and optionally spoken aloud.
7. One-shot handoffs triggered by German, English, and Russian voice commands.

## Acceptable First Native Release

- tray icon
- overlay window
- global push-to-talk
- current Anthropic / ElevenLabs / Whisper / CLI integration preserved
- current `.env` and local logging model preserved
