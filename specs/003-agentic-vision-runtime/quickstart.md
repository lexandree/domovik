# Quickstart: Agentic Vision Runtime

## Scope Of This Feature

Feature `003-agentic-vision-runtime` is the next planning layer on top of the existing Domovik runtime and Qt shell. It focuses on:

- clean semantic chat history
- explicit clearing of chat and screenshot state
- split text and vision routing
- bounded agentic visual re-check mode
- future-ready ROI and CV-assisted visual context
- internal search capabilities with a first working web-search path

For the first implementation slice:

- both `direct_vision` and `agentic_vision` are real supported runtime paths
- `agentic_vision` is capped at 3 inspection cycles
- manual ROI must be implemented in at least one UI surface, not left as a placeholder only

## Current Working Baseline

Before implementing `003`, confirm the current system still works:

```bash
cd /home/admin2/clicky
npm run start:linux
```

In another shell:

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/status
```

If using the Qt shell:

```bash
cd /home/admin2/clicky
source .venv-qt/bin/activate
python -m linux.qt_shell.app
```

## Validate Text / Vision Split

1. Configure `TEXT_PROVIDER=minimax` and a valid `MINIMAX_API_KEY` if you want text-only requests to bypass the VLM.
2. Keep `VISION_PROVIDER=openai_compat` or `VISION_PROVIDER=anthropic` for screenshot-aware turns.
3. Send one plain-text prompt and one screenshot-aware prompt.
4. Confirm:
   - text-only requests still succeed without screen context
   - screenshot-aware requests route to the vision backend

## Validate Clean History

1. Ask a question and get a response with timings visible in the UI.
2. Ask a follow-up question with history enabled.
3. Confirm the model is following semantic context only, not replaying timing banners.
4. Use the UI's history clear control.
5. Confirm the next turn behaves as a fresh conversation.
6. If a screenshot is still present, confirm history clear does not silently remove the visual context.

## Validate Clean TTS Input

1. Enable speech output.
2. Ask a question that produces a visible timing summary in the UI.
3. Confirm spoken audio contains only the assistant reply, not `[provider ... · total ...]`.

## Validate Display Envelope

1. Send a local text-only turn such as `who are you?`.
2. Confirm `/api/chat` still returns `reply` as plain semantic text.
3. Confirm additive display formatting, if present, arrives through the `display` object instead of being embedded back into history-safe reply text.

## Validate Web Search

1. Send a prompt that explicitly asks Domovik to search the web.
2. Or enable `Web search` in the browser UI or `Use web search for this turn` in the Qt shell.
3. Confirm the runtime uses the internal `searchWeb` capability backed by Tavily.
4. Confirm the current `003` implementation uses the classic runtime path for web search and does not route ordinary search turns through the screenshot-aware vision backend.
5. Confirm the final answer is grounded in returned search results rather than a generic model-only reply.
6. Confirm the response metadata shows a single bounded search step when one search is sufficient.
7. Temporarily disable or misconfigure Tavily and confirm the runtime returns an actionable failure message.

Current note:

- `003` ships classic runtime-backed web search
- a future `LangGraph`-based search/runtime layer is explicitly deferred to `004-langgraph-agent-runtime`

## Validate Vision Unavailable Fallback

1. Temporarily stop or misconfigure the vision backend.
2. Send a screenshot-aware prompt.
3. Confirm the runtime returns an actionable fallback that recommends text-only mode instead of a raw transport error.

## Validate Agentic Re-check

1. Capture or upload a screenshot.
2. Enable `Agentic re-check` in the browser UI or `Use agentic re-check for screenshot turns` in the Qt shell.
3. Ask a screenshot-aware question.
4. Confirm the runtime returns `mode: "agentic_vision"` and reuses the current screenshot instead of forcing recapture.
5. If the loop cannot resolve the question within its budget, confirm the final answer names uncertainty explicitly instead of pretending confidence.

## Validate ROI

1. Capture or upload a screenshot in the browser UI.
2. Click `select roi`.
3. Drag over a small region of the screenshot preview.
4. Confirm the ROI status updates and the screenshot itself remains loaded.
5. Ask a screenshot-aware question that refers to the selected region.
6. Confirm the request still behaves as a normal screenshot-aware turn while preserving the full screenshot context.

## Implementation Sequence

Recommended implementation order for this feature:

1. Finish semantic history cleanup across browser UI and Qt shell.
2. Separate display formatting from TTS/model context everywhere.
3. Add explicit screenshot-state clearing and mode signalling.
4. Add bounded `agentic_vision` routing in the runtime.
5. Add manual ROI support.
6. Add optional OCR/CV hooks behind the ROI/visual-session model.

## Verified Runtime Notes

The current verified runtime state for late `003` is:

- text-only turns can run through `TEXT_PROVIDER=minimax`
- screenshot-aware turns can run through `VISION_PROVIDER`
- runtime status now exposes `VISION_*` naming in its payload and configuration model
- ordinary web search uses the classic internal Tavily-backed path
- the failed experiment of routing ordinary search through a separate agent runtime is not part of `003`
