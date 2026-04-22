# Research: Agentic Vision Runtime

## Decision 1: Keep separate text and vision routing in the current runtime

- **Decision**: Preserve the current split where text-only turns can use a dedicated text backend and screenshot-aware turns use the configured vision backend.
- **Rationale**: The self-hosted VLM path is intentionally less reliable, so text quality and availability should not depend on it. This directly supports graceful degradation and avoids unnecessary vision latency for plain text turns.
- **Alternatives considered**:
  - Single shared VLM for all text and vision turns: rejected because it couples normal chat quality to the least reliable backend.
  - Always use hosted text backend and ignore direct vision replies: rejected because direct screenshot-aware replies are already working and should remain available as the faster mode.

## Decision 2: Treat agentic visual mode as an optional bounded tool loop

- **Decision**: Model the new deep-inspection flow as an explicit `agentic vision` mode with hard limits on steps, repeated failures, and total turn budget.
- **Rationale**: The goal is not to replace the current direct screenshot path, but to add a second-pass re-check mode when the first answer is unsatisfactory. Hard limits keep latency and hallucination cascades under control.
- **Alternatives considered**:
  - Unbounded tool-agent loop: rejected because it can stall on poor VLM outputs and makes latency unpredictable.
  - Always run the multi-step mode: rejected because it would slow the common case and make the UI feel heavy.

Implementation note:
- The feature must implement both paths:
  - `direct_vision`: single-pass screenshot-aware answer
  - `agentic_vision`: bounded multi-step re-check mode
- The optional part is user/runtime choice of path per turn, not whether the runtime supports `agentic_vision`.

## Decision 3: Use the VLM as a perception tool, not the sole reasoning layer

- **Decision**: In two-stage flows, the VLM should produce grounded visual observations, while a stronger text backend can produce the final user-facing explanation.
- **Rationale**: A weaker self-hosted VLM often works better when asked targeted observation questions than when forced to do both perception and polished reasoning in one pass.
- **Alternatives considered**:
  - Let the VLM produce the final answer in every screenshot-aware path: rejected because this is already the weak point the new feature is addressing.
  - Replace the VLM with MiniMax directly: rejected for now because MiniMax's public API documentation does not currently expose a documented drop-in general multimodal screenshot-chat path for this runtime.

Implementation note:
- The two-stage orchestration path is part of the `agentic_vision` implementation.
- `direct_vision` remains a first-class simpler path.

## Decision 4: Do not treat MiniMax as the primary direct multimodal backend

- **Decision**: Keep MiniMax positioned as a text and TTS backend candidate, not as the immediate replacement for direct screenshot-aware runtime chat.
- **Rationale**: MiniMax's official API overview documents text, speech, video generation, image generation, music, and file APIs. Its Anthropic-compatible API currently documents `messages` with partial support and explicitly notes no image/document input for that interface. MiniMax also documents `understand_image`, but as an MCP tool flow rather than a general replacement for the runtime's current screenshot chat surface.
- **Alternatives considered**:
  - Rebuild the screenshot-aware runtime directly on MiniMax now: rejected because the official public docs do not yet support that as a low-risk direct migration path.

## Decision 5: Keep history semantic and separate from display formatting

- **Decision**: Split stored conversation context from display-only reply formatting and ensure TTS uses plain reply text only.
- **Rationale**: Timing banners, log-path fragments, and other UI-only metadata polluted history and could be replayed by TTS or reintroduced into future prompts.
- **Alternatives considered**:
  - Keep one shared response string for everything: rejected because it already caused metadata leakage into later interactions.
  - Disable history entirely: rejected because follow-up questions are a core part of the assistant workflow.

## Decision 6: Keep screenshot state separate from chat history

- **Decision**: Treat screenshot state as its own bounded visual session, separately clearable from conversation history.
- **Rationale**: A user can want either a new chat with the same image or a continued chat with no image. These are different reset operations and should not be conflated.
- **Alternatives considered**:
  - Tie screenshot lifecycle strictly to chat history lifecycle: rejected because it is too coarse and causes confusing implicit reuse.

## Decision 7: Introduce ROI support as a layered visual context, not a replacement

- **Decision**: Add ROI as an additional image context while preserving the full-frame screenshot for grounding.
- **Rationale**: Dense screenshots, 4k displays, and medical-style images lose critical detail when reduced to one frame. ROI improves detail without discarding scene context.
- **Alternatives considered**:
  - Replace the full image with the ROI: rejected because it removes global context that may still matter to reasoning.
  - Delay ROI until after agent mode: rejected because ROI is one of the clearest tools for making a weaker VLM more useful.

## Decision 8: Keep CV-assisted preprocessing optional and additive

- **Decision**: Design for OCR/CV hooks, but do not make them mandatory for every screenshot turn in the first implementation slice.
- **Rationale**: OCR, region proposals, and anomaly hints can improve dense-image workflows, but they should remain optional helpers rather than a hard dependency for all users.
- **Alternatives considered**:
  - Force OCR/CV on every turn: rejected because it adds complexity and can slow ordinary UI questions that do not need it.
  - Ignore CV entirely: rejected because the future ROI pipeline clearly benefits from a formal extension point now.

## Decision 9: Preserve current route contracts and extend them incrementally

- **Decision**: Keep the existing local runtime routes and evolve request/response shapes incrementally instead of replacing them wholesale.
- **Rationale**: Browser UI and Qt shell both already talk to the same runtime, so additive evolution minimizes breakage.
- **Alternatives considered**:
  - Introduce a separate agent runtime service for `003`: rejected because it would add a second orchestration boundary too early.

## Decision 10: Use a dedicated agentic orchestrator prompt

- **Decision**: The runtime should use a dedicated agent/orchestrator system prompt for `agentic_vision`, distinct from the normal conversational assistant prompt.
- **Rationale**: A tool-using controller has different behavioural goals than a plain assistant reply layer. It must ask targeted visual questions, track uncertainty, respect a 3-cycle budget, and avoid drifting into generic conversational output.
- **Alternatives considered**:
  - Reuse the default assistant system prompt: rejected because it optimizes for direct user replies, not bounded orchestration.
  - Put all orchestration behaviour into ad hoc inline instructions only: rejected because it weakens consistency and makes debugging harder.

## Decision 11: Fix the initial agentic budget to 3 cycles

- **Decision**: Start with a hard limit of 3 visual inspection cycles per `agentic_vision` turn.
- **Rationale**: Three cycles is enough to allow targeted follow-up without turning the assistant into a slow recursive planner for ordinary desktop tasks.
- **Alternatives considered**:
  - 1 cycle: rejected because it collapses back into direct vision.
  - 5+ cycles: rejected because it increases latency and amplifies weak-VLM drift too quickly.

## Decision 12: Add search as an internal capability, not as MCP-first infrastructure

- **Decision**: Introduce a stable internal search capability interface now, with `performSearch(query, options)`, `searchWeb(query)`, `searchDocs(query)`, and `searchLocal(query)` as internal concepts, but implement only `searchWeb(query)` in this milestone.
- **Rationale**: Search is immediately useful, but the core assistant path should stay optimized for responsiveness. Adding search directly inside the runtime avoids the latency and complexity cost of routing the first implementation through MCP.
- **Alternatives considered**:
  - Make search MCP-only from the start: rejected because it adds overhead before the capability itself is proven useful in the product.
  - Delay all search work until a later feature: rejected because web search is a practical assistant capability that does not require waiting for the broader tools discussion.

Implementation note:
- The internal search interface should be shaped so it can later be wrapped by an MCP adapter without changing the fast local runtime path used by Domovik itself.

## Decision 13: Keep the search interface broader than the first implementation

- **Decision**: Even though only `searchWeb` will be implemented now, the internal abstraction should already reserve `searchDocs` and `searchLocal` so later expansion does not require reworking every caller.
- **Rationale**: The product clearly wants more than generic web search in the long run, but only `searchWeb` is uncontroversial enough to add immediately.
- **Alternatives considered**:
  - Define only `searchWeb` now and invent the rest later: rejected because it would likely cause avoidable interface churn.

## Decision 14: Use Tavily for the first web-search backend

- **Decision**: Implement `searchWeb(query)` through Tavily in this milestone.
- **Rationale**: Tavily provides a practical web-search API for assistant-style grounded answers without forcing the project into MCP-first infrastructure or a much broader search-provider discussion.
- **Alternatives considered**:
  - Delay provider choice and keep search abstract only: rejected because this milestone explicitly wants a working web-search capability now.
  - Start with a browser-style scraping/search implementation: rejected because it would add unnecessary fragility and maintenance cost for the first slice.
