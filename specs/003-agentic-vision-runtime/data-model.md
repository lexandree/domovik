# Data Model: Agentic Vision Runtime

## ConversationTurn

- **Purpose**: Semantic user/assistant turn retained for follow-up reasoning.
- **Fields**:
  - `user_text`: string, required
  - `assistant_text`: string, required
  - `created_at`: ISO timestamp or local monotonic turn marker
  - `mode`: enum `text | direct_vision | agentic_vision | handoff | local_identity | fallback`
  - `uses_visual_context`: boolean
- **Validation rules**:
  - Must not contain display-only timing banners, transport diagnostics, or UI log paths in `assistant_text`
  - Must be bounded by the configured history window

## DisplayReply

- **Purpose**: User-facing formatted response shown in UI surfaces.
- **Fields**:
  - `plain_text`: string, required
  - `display_text`: string, required
  - `timings`: optional object
  - `output_file_path`: optional string
  - `mode`: enum matching runtime mode
- **Validation rules**:
  - `plain_text` is the only safe input for TTS and semantic history
  - `display_text` may contain timing summaries or artifact paths

## VisualContextSession

- **Purpose**: Screenshot-related state carried across a bounded visual interaction window.
- **Fields**:
  - `session_id`: string
  - `full_image_data_url`: string, required
  - `capture_summary`: string
  - `captured_at`: timestamp
  - `mode_hint`: enum `direct_vision | agentic_vision`
  - `rois`: array of `RoiSelection`
  - `cv_hints`: array of `VisualObservation`
  - `is_active`: boolean
- **Validation rules**:
  - A session must always preserve the original full-frame image
  - Clearing screenshot state must invalidate the session without forcing history deletion

## RoiSelection

- **Purpose**: Manual or automatic crop associated with a visual session.
- **Fields**:
  - `roi_id`: string
  - `source_session_id`: string
  - `label`: optional string
  - `origin`: enum `manual | automatic`
  - `x`: number
  - `y`: number
  - `width`: number
  - `height`: number
  - `image_data_url`: string
- **Validation rules**:
  - Geometry must remain within the full-frame image bounds
  - ROI cannot replace the source full-frame image in runtime state

## VisualObservation

- **Purpose**: Grounded observation produced by the vision backend or optional CV stage.
- **Fields**:
  - `observation_id`: string
  - `source`: enum `vlm | ocr | cv`
  - `question`: string
  - `answer`: string
  - `uncertainties`: array of strings
  - `referenced_roi_ids`: array of strings
  - `created_at`: timestamp
- **Validation rules**:
  - Must stay grounded in observable visual evidence
  - Should explicitly record uncertainty when confidence is low

## AgenticVisionRun

- **Purpose**: One bounded multi-step orchestration session over an existing visual context.
- **Fields**:
  - `run_id`: string
  - `visual_session_id`: string
  - `user_goal`: string
  - `step_count`: integer
  - `max_steps`: integer
  - `status`: enum `running | completed | failed | exhausted`
  - `steps`: array of `AgenticVisionStep`
  - `final_reply`: optional string
- **Validation rules**:
  - `step_count` must not exceed `max_steps`
  - Failure and exhaustion must be explicit states

## AgenticVisionStep

- **Purpose**: One tool-use cycle inside an `AgenticVisionRun`.
- **Fields**:
  - `step_index`: integer
  - `tool_prompt`: string
  - `target`: enum `full_image | roi`
  - `target_roi_id`: optional string
  - `observation_id`: optional string
  - `result_summary`: string
  - `status`: enum `ok | failed | skipped`

## BackendRoutingState

- **Purpose**: Runtime configuration and reachability summary for routing decisions.
- **Fields**:
  - `text_provider`: enum `vision_provider | minimax`
  - `vision_provider`: enum `anthropic | openai_compat`
  - `tts_provider`: enum `elevenlabs | minimax`
  - `text_backend_available`: boolean
  - `vision_backend_available`: boolean
  - `active_mode`: enum `text | direct_vision | agentic_vision`
- **Validation rules**:
  - Text-only turns must route without depending on a reachable vision backend
  - Vision turns must report actionable fallback state when unavailable

## SearchRequest

- **Purpose**: Normalized internal request for runtime search capabilities.
- **Fields**:
  - `query`: string, required
  - `provider`: enum `web | docs | local`
  - `options`: object, optional
  - `requested_at`: timestamp
- **Validation rules**:
  - `query` must be non-empty
  - this milestone only requires `provider=web` to be executable

## SearchResult

- **Purpose**: Normalized search result returned by internal search capabilities.
- **Fields**:
  - `title`: string
  - `url`: string
  - `snippet`: string
  - `source`: enum `web | docs | local`
  - `rank`: integer
- **Validation rules**:
  - all grounded search-backed answers should be traceable to one or more returned `SearchResult` items

## SearchCapabilityState

- **Purpose**: Runtime summary of which internal search capabilities exist versus which are currently implemented.
- **Fields**:
  - `perform_search_available`: boolean
  - `search_web_available`: boolean
  - `search_docs_available`: boolean
  - `search_local_available`: boolean
- **Validation rules**:
  - this milestone must expose `search_web_available=true` when web search is configured and reachable

## State Transitions

### Conversation lifecycle

1. `empty` -> `has_turns` after first semantic reply
2. `has_turns` -> `empty` after explicit history clear

### Visual session lifecycle

1. `inactive` -> `active` after screenshot capture
2. `active` -> `active_with_roi` after ROI attachment
3. `active` -> `inactive` after explicit screenshot clear

### Agentic run lifecycle

1. `running` -> `completed` when bounded loop yields final answer
2. `running` -> `failed` on unrecoverable backend/tool failure
3. `running` -> `exhausted` when step or time budget is reached without sufficient certainty
