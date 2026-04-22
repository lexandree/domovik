# Runtime HTTP Contract: Agentic Vision Runtime

This feature extends the existing local runtime HTTP surface instead of replacing it.

## Existing Routes To Preserve

### `GET /api/status`

- **Purpose**: Runtime configuration and availability summary for browser UI and Qt shell.
- **Current contract**:
  - assistant identity
  - text and vision provider configuration
  - TTS/STT configuration
  - command paths and local runtime metadata
- **Feature 003 expectation**:
  - preserve current fields
  - add enough information to expose active interaction mode and future visual-session support without breaking existing consumers

### `POST /api/chat`

- **Purpose**: Main text and screenshot-aware interaction route.
- **Current request shape**:
```json
{
  "prompt": "string",
  "conversationHistory": [
    {
      "user": "string",
      "assistant": "string"
    }
  ],
  "screenshotDataUrl": "optional data:image/... string"
}
```

- **Current response shape**:
```json
{
  "mode": "string",
  "reply": "plain reply text",
  "rawReply": "provider reply text",
  "timings": {
    "providerMs": 1234,
    "totalMs": 1400
  },
  "outputFilePath": "optional"
}
```

- **Feature 003 contract rules**:
  - `reply` remains the semantic plain-text assistant reply
  - any UI-only timing or log metadata stays out of `reply`
  - `conversationHistory[*].assistant` must be treated as semantic history, not display formatting
  - future additive request fields may include:
    - `modeHint`
    - `visualSession`
    - `roiSelections`
    - `agenticRecheck`
  - these additions must remain backward compatible

### `POST /api/transcribe`

- **Purpose**: Convert recorded audio into transcript text.
- **Feature 003 contract rules**:
  - no breaking changes
  - transcript should remain plain semantic text suitable for prompt insertion

### `POST /api/tts`

- **Purpose**: Convert assistant reply text into playable speech.
- **Feature 003 contract rules**:
  - input text must be the plain semantic reply only
  - UI timing banners, debug suffixes, and file-path annotations must never be passed through this route as normal assistant speech content

## Planned Additive Behaviour

### Agentic visual re-check

Feature `003` should reuse `/api/chat` for the first implementation slice. The runtime may accept future additive fields such as:

```json
{
  "prompt": "Why is this dialog blocked?",
  "conversationHistory": [],
  "screenshotDataUrl": "data:image/jpeg;base64,...",
  "modeHint": "agentic_vision",
  "agenticRecheck": true
}
```

The response must remain compatible with current clients:

```json
{
  "mode": "agentic_vision",
  "reply": "plain semantic reply",
  "rawReply": "full orchestration output or provider text",
  "timings": {
    "providerMs": 2300,
    "totalMs": 4100
  }
}
```

The current implementation may also include additive routing metadata:

```json
{
  "routing": {
    "mode": "agentic_vision",
    "usesVisualContext": true,
    "textProvider": "minimax",
    "visionProvider": "openai_compat",
    "effectiveProvider": "openai_compat"
  }
}
```

### ROI support

ROI support should be additive and optional. A future request shape may include:

```json
{
  "prompt": "Read the warning in the top-right corner.",
  "screenshotDataUrl": "data:image/jpeg;base64,...",
  "roiSelections": [
    {
      "label": "warning corner",
      "x": 2800,
      "y": 100,
      "width": 700,
      "height": 400,
      "imageDataUrl": "data:image/jpeg;base64,..."
    }
  ]
}
```

The runtime must preserve the original screenshot context even when ROI data is supplied.

Current first-slice notes:

- the browser UI is the first real manual ROI surface
- the Qt shell currently keeps ROI-ready visual-session state but does not yet expose manual ROI selection

### Visual-session clear semantics

Feature `003` may also expose an additive visual-session reset route:

### `POST /api/visual-session/clear`

- **Purpose**: explicitly clear screenshot/visual-session state without clearing semantic chat history
- **Current additive response shape**:
```json
{
  "ok": true,
  "activeMode": "text",
  "visualSessionActive": false
}
```

### Internal search capability

Feature `003` should introduce an internal search capability layer without requiring MCP as the invocation mechanism.

The internal runtime concepts are:

- `performSearch(query, options)`
- `searchWeb(query)`
- `searchDocs(query)`
- `searchLocal(query)`

For this milestone, only `searchWeb(query)` must be functional, and it is expected to use Tavily behind the runtime boundary.

The internal search interface should remain stable enough that a later MCP adapter can expose the same capability surface without requiring a redesign of the runtime's direct fast path.

If search is exposed through `/api/chat`, the runtime may use additive request hints such as:

```json
{
  "prompt": "Search the web for the latest MiniMax multimodal API details.",
  "search": {
    "mode": "web"
  }
}
```

The response must remain compatible with current clients and return a grounded plain-text reply even when the implementation details stay internal.

The current implementation may use a bounded internal search loop:

- search the web with Tavily
- let the text backend decide whether to refine the query or finalize
- stop at the configured search step cap or runtime budget

The current additive response may also include search metadata such as:

```json
{
  "search": {
    "used": true,
    "mode": "web",
    "provider": "tavily",
    "query": "Search the web for the latest MiniMax multimodal API details.",
    "resultCount": 5,
    "lastRunAt": "2026-04-22T10:30:00.000Z",
    "error": ""
  }
}
```
