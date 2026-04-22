# Tasks: Agentic Vision Runtime

**Input**: Design documents from `/home/admin2/clicky/specs/003-agentic-vision-runtime/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/runtime-http.md`, `quickstart.md`

**Tests**: This feature does not require a strict test-first rollout in the spec, but implementation tasks must include syntax checks and targeted runtime/shell smoke tests where the changed behaviour is user-visible.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. `[US1]`)
- Every task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the feature workspace and align shared docs/paths for `003`.

- [X] T001 Update `/home/admin2/clicky/specs/003-agentic-vision-runtime/plan.md` summary and structure notes if implementation scope changes before coding starts
- [X] T002 Review `/home/admin2/clicky/specs/003-agentic-vision-runtime/research.md` and `/home/admin2/clicky/specs/003-agentic-vision-runtime/contracts/runtime-http.md` against the current runtime before code changes
- [X] T003 [P] Add any missing `003` implementation notes to `/home/admin2/clicky/linux/README.md` so runtime mode terminology stays aligned with the spec

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared primitives that all user stories depend on.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [X] T004 Refactor `/home/admin2/clicky/linux/server.js` to formalize `ConversationTurn` versus `DisplayReply` handling as separate concepts in the runtime
- [X] T005 Refactor `/home/admin2/clicky/linux/server.js` to formalize `BackendRoutingState` and centralize text/vision availability checks
- [X] T006 [P] Refactor `/home/admin2/clicky/linux/public/app.js` to keep semantic history state separate from display-only activity/timing text
- [X] T007 [P] Refactor `/home/admin2/clicky/linux/qt_shell/app.py` to keep semantic history, display reply text, and visual session state separate
- [X] T008 Add a bounded `VisualContextSession` state model scaffold to `/home/admin2/clicky/linux/server.js` for current screenshot plus future ROI support
- [X] T009 Add runtime/shell smoke-check notes for `003` to `/home/admin2/clicky/specs/003-agentic-vision-runtime/quickstart.md` if any foundational implementation details change

**Checkpoint**: Runtime and both UIs share the same conceptual split between semantic history, display formatting, and visual session state.

---

## Phase 3: User Story 1 - Clean conversational history (Priority: P1) 🎯 MVP

**Goal**: Keep semantic conversation history useful for follow-up questions without leaking UI-only timing text into model context or TTS.

**Independent Test**: Run a multi-turn conversation in both browser UI and Qt shell, include visible timing/status text, clear history, and verify that later prompts only use semantic turns and that speech output does not read timing banners.

- [X] T010 [US1] Update `/home/admin2/clicky/linux/server.js` so `reply` remains plain semantic text and any display-only formatting stays outside the stored assistant history path
- [X] T011 [P] [US1] Update `/home/admin2/clicky/linux/public/app.js` so browser-side `conversationHistory` stores semantic reply text only and never stores formatted timing suffixes
- [X] T012 [P] [US1] Update `/home/admin2/clicky/linux/qt_shell/app.py` so Qt-shell `conversation_history` stores semantic reply text only and keeps timing banners in display-only UI state
- [X] T013 [US1] Update `/home/admin2/clicky/linux/server.js` and `/home/admin2/clicky/linux/public/app.js` so browser TTS always uses plain semantic reply text
- [X] T014 [US1] Update `/home/admin2/clicky/linux/qt_shell/app.py` so Qt-shell speech playback always uses `latest_reply_text` with no timing/debug suffixes
- [X] T015 [P] [US1] Add or tighten explicit history-clear behaviour in `/home/admin2/clicky/linux/public/app.js` and `/home/admin2/clicky/linux/public/index.html`
- [X] T016 [P] [US1] Add or tighten explicit history-clear behaviour in `/home/admin2/clicky/linux/qt_shell/app.py` and `/home/admin2/clicky/linux/qt_shell/panel.py`
- [X] T017 [US1] Document semantic-history and clean-TTS behaviour in `/home/admin2/clicky/linux/README.md`
- [X] T018 [US1] Run browser and Qt-shell smoke checks for clean history and clean TTS using `/home/admin2/clicky/specs/003-agentic-vision-runtime/quickstart.md`

**Checkpoint**: User Story 1 is complete when history is semantic, clear/reset works, and TTS never reads timing banners.

---

## Phase 4: User Story 2 - Split text and vision backends (Priority: P1)

**Goal**: Ensure text-only prompts and screenshot-aware prompts route independently with graceful fallbacks.

**Independent Test**: Configure MiniMax for text and an OpenAI-compatible VLM for vision, then verify text-only prompts succeed while screenshot-aware prompts degrade gracefully when vision is unavailable.

- [X] T019 [US2] Refine routing in `/home/admin2/clicky/linux/server.js` so text-only and screenshot-aware turns use explicit provider selection through a single shared decision path
- [X] T020 [US2] Update `/home/admin2/clicky/linux/server.js` fallback messaging for `vision_unavailable` and `text_unavailable` so the guidance is actionable and mode-specific
- [X] T021 [P] [US2] Update `/home/admin2/clicky/linux/public/app.js` to surface text backend, vision backend, and routing mode clearly in the browser UI
- [X] T022 [P] [US2] Update `/home/admin2/clicky/linux/qt_shell/app.py` and `/home/admin2/clicky/linux/qt_shell/panel.py` to surface text backend, vision backend, and routing mode clearly in the Qt shell
- [X] T023 [US2] Update `/home/admin2/clicky/linux/.env.example` to keep text/vision backend configuration examples aligned with the refined routing model
- [X] T024 [US2] Update `/home/admin2/clicky/linux/README.md` with explicit text-only versus screenshot-aware routing behaviour and fallback expectations
- [ ] T025 [US2] Run runtime smoke checks for text-only success and vision-backend failure handling using `/home/admin2/clicky/specs/003-agentic-vision-runtime/quickstart.md`

**Checkpoint**: User Story 2 is complete when text-only requests no longer depend on vision uptime and screenshot-aware failure modes are understandable and intentional.

---

## Phase 5: User Story 3 - Agentic visual re-check mode (Priority: P1)

**Goal**: Add an optional bounded re-check mode where a stronger text backend can query the vision backend in several controlled steps before returning a revised answer.

**Independent Test**: Submit a screenshot-aware question, trigger re-check mode, and verify that the runtime performs a bounded multi-step inspection over the same captured screen context before returning a final answer or uncertainty report.

- [X] T026 [US3] Add `agentic_vision` mode scaffolding and bounded loop controls to `/home/admin2/clicky/linux/server.js` with a hard default limit of 3 inspection cycles
- [X] T027 [US3] Implement a `VisualObservation`/`AgenticVisionRun` execution path in `/home/admin2/clicky/linux/server.js` that reuses the current screenshot context instead of forcing recapture
- [X] T028 [US3] Implement a dedicated agentic orchestrator system prompt in `/home/admin2/clicky/linux/server.js` that is separate from the default assistant prompt and optimized for bounded visual tool use
- [X] T029 [US3] Implement a two-path screenshot architecture in `/home/admin2/clicky/linux/server.js` where `direct_vision` remains available and `agentic_vision` uses a two-stage orchestration path with grounded VLM observations plus a stronger text backend final answer
- [X] T030 [US3] Add explicit runtime-side visual-session clear semantics to `/home/admin2/clicky/linux/server.js` so screenshot reset and history reset remain independent
- [X] T031 [P] [US3] Extend `/home/admin2/clicky/specs/003-agentic-vision-runtime/contracts/runtime-http.md` and `/home/admin2/clicky/linux/README.md` with additive `modeHint`, `agenticRecheck`, and visual-session clear semantics if the implementation finalizes them
- [X] T032 [P] [US3] Add browser-side mode trigger and state display to `/home/admin2/clicky/linux/public/index.html` and `/home/admin2/clicky/linux/public/app.js`
- [X] T033 [P] [US3] Add Qt-shell mode trigger and state display to `/home/admin2/clicky/linux/qt_shell/panel.py` and `/home/admin2/clicky/linux/qt_shell/app.py`
- [X] T034 [US3] Ensure `/home/admin2/clicky/linux/server.js` returns explicit uncertainty when the bounded loop reaches the 3-cycle or time limit
- [ ] T035 [US3] Run end-to-end smoke tests for direct vision versus agentic re-check mode and record any implementation clarifications back into `/home/admin2/clicky/specs/003-agentic-vision-runtime/quickstart.md`

**Checkpoint**: User Story 3 is complete when direct vision remains available and a separate bounded agentic re-check path can be triggered intentionally.

---

## Phase 6: User Story 4 - ROI and CV-assisted inspection (Priority: P2)

**Goal**: Preserve full-frame image grounding while allowing detailed ROI-assisted inspection and future CV hooks.

**Independent Test**: Capture a full screenshot, add a manual ROI, and verify that the runtime can use both the full image and the ROI without discarding global context.

- [X] T036 [US4] Extend `/home/admin2/clicky/linux/server.js` visual session model to accept and preserve optional ROI data alongside the full-frame screenshot
- [X] T037 [US4] Implement the first real manual ROI flow in `/home/admin2/clicky/linux/public/app.js` and `/home/admin2/clicky/linux/public/index.html`
- [X] T038 [P] [US4] Extend `/home/admin2/clicky/linux/qt_shell/capture.py`, `/home/admin2/clicky/linux/qt_shell/panel.py`, and `/home/admin2/clicky/linux/qt_shell/app.py` with ROI-ready session structures even if the first real manual ROI UI ships only in the browser surface
- [X] T039 [US4] Extend `/home/admin2/clicky/specs/003-agentic-vision-runtime/contracts/runtime-http.md` with additive ROI request semantics that preserve backward compatibility
- [ ] T040 [US4] Add CV/OCR hook extension points to `/home/admin2/clicky/linux/server.js` without making them mandatory for ordinary turns
- [X] T041 [US4] Update `/home/admin2/clicky/linux/README.md` and `/home/admin2/clicky/specs/003-agentic-vision-runtime/quickstart.md` with ROI usage, the first supported UI surface, and non-goals for the first slice

**Checkpoint**: User Story 4 is complete when ROI is modeled as additional context, not as a replacement for the full image, and CV hooks have a defined insertion point.

---

## Phase 7: User Story 5 - Explicit mode and state handling (Priority: P2)

**Goal**: Make current interaction mode, screenshot state, and reset controls obvious to the user.

**Independent Test**: Move between text-only, direct screenshot, and agentic screenshot turns and verify that the active mode and reset operations are visible and predictable.

- [ ] T042 [US5] Add explicit active-mode state to `/home/admin2/clicky/linux/server.js` status payloads and chat responses where appropriate
- [ ] T043 [P] [US5] Update `/home/admin2/clicky/linux/public/app.js` and `/home/admin2/clicky/linux/public/index.html` to show active mode, screenshot-present state, and separate clear actions for history versus visual context
- [ ] T044 [P] [US5] Update `/home/admin2/clicky/linux/qt_shell/app.py` and `/home/admin2/clicky/linux/qt_shell/panel.py` to show active mode, screenshot-present state, and separate clear actions for history versus visual context
- [ ] T045 [US5] Ensure screenshot-clear operations in `/home/admin2/clicky/linux/public/app.js` and `/home/admin2/clicky/linux/qt_shell/app.py` do not silently clear chat history
- [ ] T046 [US5] Update `/home/admin2/clicky/linux/README.md` to explain the difference between text mode, direct vision mode, agentic vision mode, history clear, and screenshot clear

**Checkpoint**: User Story 5 is complete when users can reliably tell what mode they are in and reset only the state they intend to reset.

---

## Phase 8: User Story 6 - Built-in web search capability (Priority: P2)

**Goal**: Add an internal search capability layer now, with a first working Tavily-backed `searchWeb` implementation that does not require MCP.

**Independent Test**: Send a prompt that explicitly requests web search, verify the runtime performs a real web lookup, and confirm the final answer is grounded in returned results or a clear failure message.

- [ ] T047 [US6] Define the internal search capability interface in `/home/admin2/clicky/linux/server.js` around `performSearch(query, options)`, `searchWeb(query)`, `searchDocs(query)`, and `searchLocal(query)` so it can later be wrapped by an MCP adapter without changing the direct runtime fast path
- [ ] T048 [US6] Add Tavily configuration and runtime wiring for `searchWeb(query)` in `/home/admin2/clicky/linux/server.js` and `/home/admin2/clicky/linux/.env.example`
- [ ] T049 [US6] Implement the first working Tavily-backed `searchWeb(query)` path in `/home/admin2/clicky/linux/server.js`
- [ ] T050 [US6] Add grounded failure handling for unavailable or failed Tavily-backed web search in `/home/admin2/clicky/linux/server.js`
- [ ] T051 [P] [US6] Update `/home/admin2/clicky/linux/public/app.js` and `/home/admin2/clicky/linux/public/index.html` so the browser surface can explicitly trigger or reflect web-search-backed turns
- [ ] T052 [P] [US6] Update `/home/admin2/clicky/linux/qt_shell/app.py` and `/home/admin2/clicky/linux/qt_shell/panel.py` so the Qt shell can explicitly trigger or reflect web-search-backed turns
- [ ] T053 [US6] Update `/home/admin2/clicky/linux/README.md` and `/home/admin2/clicky/specs/003-agentic-vision-runtime/contracts/runtime-http.md` with the internal search capability contract, Tavily backend note, and current `searchWeb`-only scope
- [ ] T054 [US6] Run a Tavily-backed web-search smoke test and failure-path validation using `/home/admin2/clicky/specs/003-agentic-vision-runtime/quickstart.md`

**Checkpoint**: User Story 6 is complete when Domovik can search the web directly through the runtime without relying on MCP.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Clean up the feature after all desired stories are implemented.

- [ ] T055 [P] Review `/home/admin2/clicky/README.md`, `/home/admin2/clicky/README.ru.md`, and `/home/admin2/clicky/AGENTS.md` for any stale pre-`003` wording about history, vision routing, search, or Domovik mode behaviour
- [ ] T056 [P] Run `node --check /home/admin2/clicky/linux/server.js` and `node --check /home/admin2/clicky/linux/public/app.js`
- [ ] T057 [P] Run `python3 -m py_compile /home/admin2/clicky/linux/qt_shell/app.py /home/admin2/clicky/linux/qt_shell/panel.py /home/admin2/clicky/linux/qt_shell/overlay.py /home/admin2/clicky/linux/qt_shell/capture.py`
- [ ] T058 [P] Run `npm run test:triggers` from `/home/admin2/clicky`
- [ ] T059 Run the full `003` quickstart validation from `/home/admin2/clicky/specs/003-agentic-vision-runtime/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies
- **Phase 2 (Foundational)**: depends on Phase 1 and blocks all user stories
- **Phase 3 (US1)**: depends on Phase 2
- **Phase 4 (US2)**: depends on Phase 2 and benefits from US1, but can begin once foundational work is complete
- **Phase 5 (US3)**: depends on Phase 2 and on the routing/history model established by US1 and US2
- **Phase 6 (US4)**: depends on Phase 2 and should build after US3 defines the visual-session/runtime shape
- **Phase 7 (US5)**: depends on earlier user stories because it reflects final mode and reset behaviour
- **Phase 8 (US6)**: depends on Phase 2 and benefits from the explicit runtime mode/state work, but can be implemented after the core routing model is stable
- **Phase 9 (Polish)**: depends on all selected stories being complete

### User Story Dependencies

- **US1**: first MVP story, no dependency on later stories
- **US2**: depends on foundational routing primitives, but not on agentic mode
- **US3**: depends on semantic history and split routing being in place
- **US4**: depends on visual-session scaffolding from US3
- **US5**: depends on the mode/state model from US1-US4
- **US6**: depends on the foundational runtime state split and benefits from the explicit mode/state model, but does not require ROI or agentic vision to land first

### Within Each User Story

- Runtime state model before UI exposure
- Browser and Qt shell updates can often run in parallel after runtime semantics are set
- Documentation and smoke validation happen at the end of each story

### Parallel Opportunities

- Foundational UI refactors in browser and Qt shell can run in parallel once runtime concepts are agreed
- For each story, browser UI and Qt shell work can run in parallel once runtime changes land
- Final syntax checks and trigger tests can run in parallel

---

## Parallel Example: User Story 1

```bash
# Browser and Qt-shell semantic history cleanup can proceed in parallel
Task: "Update /home/admin2/clicky/linux/public/app.js so browser-side conversationHistory stores semantic reply text only"
Task: "Update /home/admin2/clicky/linux/qt_shell/app.py so Qt-shell conversation_history stores semantic reply text only"

# Clear controls can also proceed in parallel after runtime semantics are stable
Task: "Add or tighten explicit history-clear behaviour in /home/admin2/clicky/linux/public/app.js and /home/admin2/clicky/linux/public/index.html"
Task: "Add or tighten explicit history-clear behaviour in /home/admin2/clicky/linux/qt_shell/app.py and /home/admin2/clicky/linux/qt_shell/panel.py"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate semantic history and clean TTS end-to-end

### Incremental Delivery

1. Ship clean semantic history and TTS hygiene first
2. Strengthen split text/vision routing and fallbacks
3. Add agentic visual re-check mode
4. Add ROI support and CV hooks
5. Add built-in Tavily-backed web search
6. Finish with explicit mode/reset UX and final polish

### Parallel Team Strategy

With multiple developers:

1. One developer owns runtime state/routing in `linux/server.js`
2. One developer owns browser UI in `linux/public/`
3. One developer owns Qt-shell updates in `linux/qt_shell/`
4. Merge per-story after runtime semantics are stable

---

## Notes

- `[P]` tasks touch different files and can run in parallel after prerequisites land
- Each story is intended to be independently demonstrable
- Keep runtime contracts additive and backward compatible
- Do not rename GNOME extension UUIDs or schema IDs during `003`
- Late `003` implementation settled on the classic runtime path for ordinary web search.
- A separate `LangGraph` agent runtime is out of scope for `003` and belongs to `004-langgraph-agent-runtime`.
