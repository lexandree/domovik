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

On the current GNOME/Wayland development machine, the most reliable shell launch command is:

```bash
DOMOVIK_QT_PLATFORM=xcb LOG_LEVEL=3 python -m linux.qt_shell.app
```

This launch mode currently preserves the expected desktop text scaling and enables verbose shell logging in `linux/data/logs/qt-shell.log`.

`LOG_LEVEL` for the Qt shell currently supports these levels:

- `0`: silent
- `1`: errors only
- `2`: info and errors
- `3`: debug, info, and errors

If `LOG_LEVEL` is unset or invalid, the shell uses level `2`.
Qt shell logs are written to `linux/data/logs/qt-shell.log`.

## Configuration

The relevant variables are listed in `linux/.env.example`.

Prompt templates for the runtime now live in:

- `linux/prompts.json` for runtime/system prompt text
- `SOUL.md` for assistant identity and personality

The split is intentional:

- edit `SOUL.md` when you want to change who Domovik is
- edit `linux/prompts.json` when you want to change how the runtime frames text,
  vision, agentic vision, or screenshot grounding behavior

- `VISION_PROVIDER`: `anthropic` or `openai_compat`
- `TEXT_PROVIDER`: `vision_provider` or `minimax`
- `ANTHROPIC_API_KEY`: primary LLM with screenshot understanding when `VISION_PROVIDER=anthropic`
- `ANTHROPIC_MODEL`: default `claude-sonnet-4-20250514`
- `VISION_BASE_URL`: base URL of the screenshot-aware vision backend, for example your tunnel to Kaggle
- `VISION_API_KEY`: API key for the vision backend; often `EMPTY` for your own `vLLM`
- `VISION_MODEL`: model name for the vision backend
- `VISION_MAX_IMAGES`: how many images that backend accepts per prompt. Use `1` for a strict single-image `vLLM` setup, or `2` if you want Domovik to send both full screenshot and ROI together
- `TAVILY_API_KEY`: enables the built-in Tavily-backed `searchWeb` capability for web-search turns
- `AGENTIC_MAX_CYCLES`: hard cap for bounded agentic cycles across runtime planner loops, default `3`
- `AGENTIC_RUNTIME_SECONDS`: total runtime budget for one bounded agentic loop, default `15`
- `VISUAL_AUGMENTATION_PROVIDERS`: reserved comma-separated hook list for future OCR/CV providers; empty keeps ordinary turns unchanged
- `VISION_CF_ACCESS_CLIENT_ID`, `VISION_CF_ACCESS_CLIENT_SECRET`: optional for Cloudflare Access-protected vision endpoints
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
- the runtime keeps an explicit per-turn routing mode:
  - `text` for plain text-only turns
  - `direct_vision` for screenshot-aware turns in the current slice
  - `agentic_vision` for bounded screenshot re-check turns

If a screenshot is attached but the configured vision backend is unavailable, the runtime returns a normal assistant reply that tells the user to switch to text-only mode instead of failing with a hard error.
If text generation is configured through MiniMax and that backend is unavailable, the runtime returns an actionable text-backend failure reply instead of a transport-style crash.

## Built-in Web Search

The runtime now includes an internal search capability layer:

- `performSearch(query, options)`
- `searchWeb(query)`
- `searchDocs(query)`
- `searchLocal(query)`

For the current slice, only `searchWeb(query)` is implemented. It uses Tavily behind the runtime boundary and can be triggered through the browser UI or Qt shell search toggle, or by an explicit prompt such as `search the web for ...`.

Current search behaviour:

- web search is additive and uses `/api/chat`
- the runtime now uses a bounded search loop rather than a single fixed Tavily call
- the planner may refine the query and search again before finalizing
- the loop stops at the configured agentic cycle cap or runtime budget
- the final answer stays plain semantic text
- returned search metadata stays outside TTS/history-safe reply text
- if Tavily is unavailable, the runtime returns an actionable failure reply instead of pretending the search succeeded

## Deep Agents Migration Scaffold

Domovik now includes a separate agent runtime boundary under:


Current migration status:

- fast path stays in `linux/server.js`
- bounded web-search orchestration currently uses the built-in classic runtime
- bounded vision re-check remains on the classic path for now

This lets the project adopt Deep Agents incrementally instead of rewriting the whole runtime in one step.

## Agentic Vision Re-check

The current `003` slice now exposes an additive screenshot re-check path:

- browser UI: `Agentic re-check`
- Qt shell: `Use agentic re-check for screenshot turns`

When that mode is enabled for a screenshot turn, the runtime:

- keeps using the same captured screenshot
- runs a bounded re-check loop
- asks the vision backend focused follow-up inspection questions
- lets the text backend decide whether to inspect again or finalize
- stops after the configured agentic cycle cap or runtime budget and reports uncertainty explicitly if needed

The runtime also exposes `POST /api/visual-session/clear` so screenshot state can be cleared independently from chat history.

## ROI Support

The first real manual ROI flow now ships in the browser UI:

- capture or upload a screenshot
- click `select roi`
- drag over the preview
- the runtime keeps both the full screenshot and the cropped ROI for the turn

The current first slice is intentionally asymmetric:

- browser UI: real manual ROI selection
- Qt shell: ROI-ready session structure only, no manual crop UI yet

ROI is additive context. It does not replace the full screenshot, and the runtime forwards both to screenshot-aware backends when ROI is present.

## Semantic History And Display Replies

Domovik now keeps three different pieces of turn state separate:

- semantic conversation history for follow-up turns
- display-only reply formatting such as timing banners and log-path hints
- visual session state for the current screenshot context

The important rule is:

- `reply` is always plain semantic text
- TTS always uses plain semantic text
- UI timing banners and log hints live in display-only state and must not be fed back into history

Clearing chat history does not clear the current screenshot. The browser UI and Qt shell now treat those as separate state buckets even before full visual-session controls land.

## Mode And Reset Semantics

Domovik now exposes the current interaction mode explicitly:

- `text`: no active screenshot is being used for the turn
- `direct_vision`: the current screenshot is sent directly to the configured vision backend
- `agentic_vision`: the current screenshot stays fixed while the runtime performs a bounded re-check loop before finalizing

History reset and screenshot reset are intentionally separate:

- `clear chat history` removes semantic conversation memory but keeps the current screenshot context
- `clear screenshot` or `clear visual session` removes the current screenshot and ROI state but keeps chat history
- `clear roi` removes only the current ROI and keeps the full screenshot

This split is intentional so users can retry a screenshot turn without losing the conversation, or clear the image context without wiping the conversation thread.

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
