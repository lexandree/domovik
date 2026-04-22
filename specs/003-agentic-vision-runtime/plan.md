# Implementation Plan: Agentic Vision Runtime

**Branch**: `003-agentic-vision-runtime` | **Date**: 2026-04-19 | **Spec**: [`/home/admin2/clicky/specs/003-agentic-vision-runtime/spec.md`](/home/admin2/clicky/specs/003-agentic-vision-runtime/spec.md)
**Input**: Feature specification from `/home/admin2/clicky/specs/003-agentic-vision-runtime/spec.md`

## Summary

Add a clean state model for Domovik's browser and Qt shell chat flows, formalize split text and vision routing, define a selectable bounded agentic visual re-check mode that can orchestrate a weaker VLM with a stronger text backend, and introduce an internal search capability layer with a first working `searchWeb` implementation via Tavily. The implementation should preserve current runtime routes, clean history and TTS inputs, and support Domovik's point-and-ask desktop workflow for actions like finding causes, finding sources, clarifying on-screen text, translating, pronouncing, and searching further without forcing MCP into the first implementation slice. The first implementation pass should also keep `reply` plain while moving display-only formatting into an additive display envelope and a bounded visual-session scaffold.

## Scope Boundary Note

Feature `003` now intentionally ends with:

- classic internal web search via Tavily
- split text and vision routing
- direct vision and bounded agentic visual re-check
- ROI-capable visual session handling
- clean semantic history and clean TTS input

Feature `003` does **not** include a production `LangGraph` agent runtime for search or screenshot workflows.
That architecture work has been explicitly deferred to feature `004-langgraph-agent-runtime`.

## Technical Context

**Language/Version**: Node.js >=20 for runtime, browser JavaScript for web UI, Python 3.11+ for Qt shell  
**Primary Dependencies**: Node built-ins only in `linux/server.js`, PySide6 shell, existing MiniMax/OpenAI-compatible/Anthropic HTTP integrations, existing GNOME Shell extension adapter, internal search abstraction with first Tavily-backed web-search implementation  
**Storage**: local files only: `linux/.env`, `linux/data/`, `codex output/`, in-memory conversation and visual session state in runtime/UI  
**Testing**: `node --check`, `python3 -m py_compile`, existing `npm run test:triggers`, manual runtime and shell smoke tests  
**Target Platform**: Ubuntu/Linux desktop, with browser UI and Qt shell both supported during this milestone  
**Project Type**: local desktop assistant runtime plus native desktop shell  
**Performance Goals**: preserve fast text-only turns when vision is unavailable, keep agentic visual loops bounded to 3 inspection cycles per turn, avoid TTS replay of UI-only metadata  
**Constraints**: self-hosted vision backend is less reliable than hosted text backends, screenshot payloads must stay bounded for 4k displays, no breaking changes to current local routes, GNOME extension schema/UUID must stay stable for installed users, agentic visual mode requires a dedicated orchestrator prompt separate from the default assistant prompt, search should keep a low-latency direct runtime path even if later exposed through MCP  
**Scale/Scope**: single-user local desktop workflow, 2 user-facing chat surfaces, 1 local runtime, bounded per-turn visual session state, first milestone includes direct vision, agentic vision, real manual ROI implementation in one UI surface, and a first working internal `searchWeb` path backed by Tavily

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The current `.specify/memory/constitution.md` is still an unfilled template and does not define enforceable project gates yet.

Pre-research check:
- No constitution violations are currently detectable because the constitution has placeholder content only.
- This plan stays aligned with the repository's working conventions: local-first, Linux-first, minimal new dependencies, preserve existing runtime contracts while adding new behaviour behind explicit modes.

Post-design check:
- Design remains within existing runtime/shell split.
- No new mandatory external services are introduced.
- Existing routes are extended rather than replaced.

## Project Structure

### Documentation (this feature)

```text
/home/admin2/clicky/specs/003-agentic-vision-runtime/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
/home/admin2/clicky/
├── linux/
│   ├── server.js
│   ├── public/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── styles.css
│   ├── qt_shell/
│   │   ├── app.py
│   │   ├── panel.py
│   │   ├── overlay.py
│   │   ├── bridge.py
│   │   ├── capture.py
│   │   ├── audio_capture.py
│   │   ├── tts_player.py
│   │   └── hotkeys.py
│   ├── gnome_extension/
│   └── tests/
├── scripts/
├── specs/
├── SOUL.md
├── README.md
└── requirements-desktop.txt
```

**Structure Decision**: Keep the existing split architecture. `linux/server.js` remains the runtime orchestration boundary, `linux/public/` and `linux/qt_shell/` remain the two user-facing surfaces, and feature `003` extends those components with cleaner state handling plus new agentic visual routing primitives. No new top-level app or service is introduced.

## Complexity Tracking

No constitution violations require justification at this time because the constitution has not yet been populated with project-specific gates.
