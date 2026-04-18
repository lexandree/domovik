# Feature Specification: Agentic Vision Runtime

**Feature Branch**: `003-agentic-vision-runtime`  
**Created**: 2026-04-18  
**Status**: Active  
**Input**: User description: "Formalize the next runtime milestone around chat history, clean reply handling, split text and vision backends, an optional agentic visual re-check mode, and ROI/CV-assisted screen analysis."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clean conversational history (Priority: P1)

As a Linux desktop assistant user, I want conversation history to help follow-up questions without replaying UI-only noise back into the model or the speech reader.

**Why this priority**: The current shell and browser flows are already multi-turn, so history hygiene is now a correctness issue rather than a future enhancement.

**Independent Test**: Run a multi-turn conversation in both the browser UI and Qt shell, include timed replies and status text, clear history, and verify that only user/assistant semantic turns are retained and that cleared history no longer affects later replies.

**Acceptance Scenarios**:

1. **Given** a chat turn completed with timing metadata, **When** the turn is added to history, **Then** only the semantic assistant reply is retained for future model context.
2. **Given** the user clears history, **When** the next prompt is sent, **Then** no older turns are included in the runtime request.
3. **Given** auto-speak is enabled, **When** a reply is spoken, **Then** UI-only metadata such as timing summaries is not sent to TTS.

---

### User Story 2 - Split text and vision backends (Priority: P1)

As a user, I want text-only prompts to use the best available text backend and screenshot-aware prompts to use the configured vision backend, with graceful fallback when one backend is unavailable.

**Why this priority**: The self-hosted vision path is less reliable by design, so text quality and availability should not depend on it.

**Independent Test**: Configure MiniMax for text and an OpenAI-compatible VLM for vision, then verify text-only prompts succeed when vision is offline and screenshot-aware prompts fail gracefully with actionable guidance.

**Acceptance Scenarios**:

1. **Given** the text backend is configured and the vision backend is offline, **When** the user sends a text-only prompt, **Then** the runtime returns a normal text response.
2. **Given** a screenshot-aware prompt is sent while the vision backend is offline, **When** the runtime handles the request, **Then** it returns a grounded fallback message that recommends text-only mode instead of a hard transport error.
3. **Given** both backends are available, **When** the user sends text-only or screenshot-aware requests, **Then** the runtime routes each turn to the correct backend and reports that configuration in runtime status.

---

### User Story 3 - Agentic visual re-check mode (Priority: P1)

As a user who is not satisfied with the first screenshot answer, I want an optional deeper inspection mode where a strong text model can ask targeted follow-up questions to the vision backend before producing a revised answer.

**Why this priority**: A weaker self-hosted VLM often benefits from orchestration by a stronger text model instead of being forced to deliver the final answer in one pass.

**Independent Test**: Submit a screenshot-aware question, trigger a re-check mode, and verify that the runtime performs a bounded multi-step tool loop against the same captured screen context before returning a revised answer.

**Acceptance Scenarios**:

1. **Given** a screenshot-aware turn has already captured screen context, **When** the user requests a deeper re-check, **Then** the runtime reuses the existing captured image instead of forcing a new screenshot immediately.
2. **Given** agentic visual mode is enabled, **When** the text orchestrator needs more grounded detail, **Then** it may issue a bounded number of targeted screen-inspection subqueries to the VLM.
3. **Given** the agentic loop reaches its configured step limit, **When** it still has uncertainty, **Then** the final answer explicitly reports uncertainty instead of pretending confidence.

---

### User Story 4 - ROI and CV-assisted inspection (Priority: P2)

As a user working with dense screenshots or images, I want optional region-of-interest and computer-vision assisted analysis so the assistant can inspect the most relevant part of the image in higher detail.

**Why this priority**: Full-frame screenshots and medical-style images often lose critical detail when forced into one downscaled pass.

**Independent Test**: Capture a full screenshot, add a manual or automatic ROI, and verify that the runtime can use both the global image and the detailed crop during a screenshot-aware or agentic turn.

**Acceptance Scenarios**:

1. **Given** a full screenshot is available, **When** the user selects a manual ROI, **Then** the runtime stores both the global image and the cropped image for the current turn.
2. **Given** CV-assisted ROI proposal is available, **When** the runtime or user requests detail, **Then** the system can provide one or more candidate regions without discarding the full-frame context.
3. **Given** the user asks about a small text region or localized anomaly, **When** ROI mode is used, **Then** the system prefers the ROI for fine detail while preserving full-scene grounding.

---

### User Story 5 - Explicit mode and state handling (Priority: P2)

As a user, I want the assistant to make it clear whether the current turn is plain text, direct vision, or agentic vision, and I want controls to reset that state when needed.

**Why this priority**: As the runtime grows more capable, hidden mode switches will make behaviour harder to predict.

**Independent Test**: Move between text-only, direct screenshot, and agentic screenshot turns and verify the UI exposes the active mode, current screenshot state, and history reset controls.

**Acceptance Scenarios**:

1. **Given** a screenshot is still loaded, **When** the user clears screen context, **Then** subsequent turns are treated as text-only unless a new screenshot or ROI is attached.
2. **Given** the runtime has multiple interaction modes, **When** a response is shown, **Then** the user can tell which mode produced it.
3. **Given** the user starts a fresh conversation, **When** they trigger a new chat or clear history, **Then** old turns and stale screenshot context are not silently reused.

## Edge Cases

- What happens when the text backend is available but the vision backend times out or returns malformed output?
- What happens when the agentic loop asks the VLM a low-quality or redundant follow-up question?
- What happens when a screenshot is too large, too dense, or too low contrast for a reliable first-pass answer?
- What happens when a manual ROI conflicts with an automatically proposed ROI?
- What happens when TTS is requested for a reply that contains timing summaries, debug text, or log paths?
- What happens when the user clears history but not the current screenshot, or clears the screenshot but not the history?
- What happens when the runtime cannot determine whether a follow-up prompt still refers to the previous screenshot?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain a semantic conversation history for browser and Qt shell flows that excludes UI-only metadata such as timing summaries and log annotations.
- **FR-002**: The system MUST provide explicit history clearing for every user-facing chat surface that supports multi-turn interaction.
- **FR-003**: The system MUST keep text-to-speech input separate from display-only reply formatting so spoken output does not include timing or transport metadata.
- **FR-004**: The runtime MUST support separate text and vision providers and route turns according to whether screen context is present.
- **FR-005**: The runtime MUST degrade gracefully when the configured vision backend is unavailable by returning an actionable text fallback instead of a raw backend error.
- **FR-006**: The runtime MUST degrade gracefully when the configured text backend is unavailable by returning an actionable fallback instead of a raw backend error.
- **FR-007**: The system MUST support a direct screenshot-aware mode where a single vision-capable backend returns the final answer for the turn.
- **FR-008**: The system MUST support an optional agentic visual mode where a text orchestrator can query a vision backend in multiple bounded steps before producing the final user reply.
- **FR-009**: The agentic visual mode MUST enforce explicit loop limits for step count, repeated failures, and total runtime budget.
- **FR-010**: The system MUST preserve the currently captured screenshot context for a bounded follow-up window so a re-check mode can reuse it without forcing immediate recapture.
- **FR-011**: The system MUST support clearing screenshot context independently from clearing chat history.
- **FR-012**: The system MUST support manual ROI selection as an additional image context for the current turn or visual session.
- **FR-013**: The architecture SHOULD support optional CV-assisted preprocessing such as OCR, region proposals, saliency cues, or anomaly hints without making those steps mandatory for every turn.
- **FR-014**: When ROI data is present, the runtime MUST preserve the full-frame image and MUST NOT replace it entirely with the crop.
- **FR-015**: The runtime SHOULD allow a two-stage path where the vision backend produces grounded visual observations and a stronger text backend produces the final user-facing answer.
- **FR-016**: The system MUST expose enough runtime status for the user to see which text provider, vision provider, and interaction mode are active.
- **FR-017**: The system MUST keep assistant identity, provider disclosure, and training-cutoff disclosure consistent across direct and agentic modes.
- **FR-018**: The system MUST avoid replaying stale screenshots or ROI artifacts into a new conversation after the user explicitly resets state.

### Key Entities *(include if feature involves data)*

- **ConversationTurn**: A semantic user/assistant exchange stored for model context, excluding presentation-only metadata.
- **DisplayReply**: The user-facing formatted reply, which may include timing or debug annotations that must not automatically flow into model context or TTS.
- **VisualContextSession**: The currently active screenshot-related state, including the full image, optional ROI images, capture timestamp, and mode flags.
- **RoiSelection**: A manual or automatic crop associated with a visual session, including geometry, source image reference, and optional user label.
- **VisualObservation**: A grounded output from the vision backend, such as extracted text, observed UI elements, uncertainties, or targeted answers.
- **AgenticVisionRun**: A bounded multi-step orchestration run that coordinates a text model and a vision backend over one visual session.
- **BackendRoutingState**: The runtime configuration describing current text provider, vision provider, fallback status, and reachability hints.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Text-to-speech never speaks timing summaries, provider timing banners, or other UI-only metadata for normal assistant replies.
- **SC-002**: A user can explicitly clear history and verify that subsequent turns no longer depend on previous semantic chat state.
- **SC-003**: A text-only prompt continues to succeed when the vision backend is unavailable, provided the configured text backend is reachable.
- **SC-004**: A screenshot-aware prompt returns a graceful fallback message rather than a raw backend transport failure when the vision backend is unavailable.
- **SC-005**: In agentic visual mode, the runtime completes within a bounded step budget and can return either a revised answer or an explicit uncertainty report.
- **SC-006**: When ROI mode is used on a dense image, the runtime can reason over both the global frame and the detailed crop without losing full-scene context.

## Assumptions

- MiniMax is currently a viable text and TTS backend candidate, but not yet a documented drop-in replacement for the general screenshot-aware multimodal chat path used by this runtime.
- The self-hosted OpenAI-compatible VLM path remains less reliable than hosted text backends and therefore benefits from explicit fallback design.
- Qt shell and browser UI will continue to coexist during this milestone, so history and screenshot-state behaviour should stay aligned across both.
- ROI support may begin with manual selection before automatic CV proposals are introduced.
