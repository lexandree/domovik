"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(__dirname, "public");
const envFilePath = path.join(__dirname, ".env");
const promptsFilePath = path.join(__dirname, "prompts.json");
const soulFilePath = path.join(repoRoot, "SOUL.md");
const dataRoot = path.join(__dirname, "data");
const visionDebugRoot = path.join(dataRoot, "vision-debug");
const searchDebugRoot = path.join(dataRoot, "search-debug");
const codexOutputRoot = path.join(repoRoot, "codex output");
const screenCaptureRoot = path.join(codexOutputRoot, "screen captures");
const anthropicMessagesUrl = "https://api.anthropic.com/v1/messages";
const visionChatCompletionsPath = "chat/completions";
const defaultMiniMaxTextBaseUrl = "https://api.minimax.io/v1";
const miniMaxTextChatPath = "text/chatcompletion_v2";
const elevenLabsSpeechToTextUrl = "https://api.elevenlabs.io/v1/speech-to-text";
const elevenLabsTextToSpeechBaseUrl = "https://api.elevenlabs.io/v1/text-to-speech";
const defaultMiniMaxTextToSpeechUrl = "https://api.minimax.io/v1/t2a_v2";
const tavilySearchUrl = "https://api.tavily.com/search";
const maxRequestBytes = 30 * 1024 * 1024;
const defaultAgenticMaxCycles = 3;
const defaultAgenticRuntimeSeconds = 15;
const defaultSearchHttpTimeoutSeconds = 12;
const maxTavilyQueryLength = 400;
const defaultSpeechKeyterms = [
  "Codex",
  "Claude Code",
  "OpenClaw",
  "screenshot",
  "screen shot",
  "скриншот",
  "скриншотом",
  "bildschirm",
  "hauptbildschirm"
];
const environmentConfiguration = loadEnvironmentConfiguration();
const promptTemplates = loadPromptTemplates();
ensureDirectorySync(dataRoot);
ensureDirectorySync(visionDebugRoot);
ensureDirectorySync(searchDebugRoot);
ensureDirectorySync(codexOutputRoot);
const runtimeState = {
  lastInteractionMode: "text",
  visualContextSession: createEmptyVisualContextSession(),
  backendHealth: {
    text: createBackendHealthState(),
    vision: createBackendHealthState()
  },
  lastSearch: createEmptySearchState()
};

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

      if (request.method === "GET" && requestUrl.pathname === "/api/status") {
        return sendJson(response, 200, buildStatusPayload());
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
        const body = await readJsonBody(request);
        const result = await handleChatRequest(body);
        return sendJson(response, 200, result);
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/visual-session/clear") {
        clearVisualContextSession();
        return sendJson(response, 200, {
          ok: true,
          activeMode: runtimeState.lastInteractionMode,
          visualSessionActive: runtimeState.visualContextSession.isActive
        });
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/transcribe") {
        const body = await readJsonBody(request);
        const result = await handleTranscriptionRequest(body);
        return sendJson(response, 200, result);
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/tts") {
        const body = await readJsonBody(request);
        const result = await handleTextToSpeechRequest(body);
        return sendJson(response, 200, result);
      }

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ok");
        return;
      }

      await serveStaticFile(requestUrl.pathname, response);
    } catch (error) {
      const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : 500;
      sendJson(response, statusCode, {
        error: error && error.message ? error.message : "Unknown server error."
      });
    }
  });
}

function startServer() {
  const server = createServer();
  server.listen(environmentConfiguration.port, "127.0.0.1", () => {
    process.stdout.write(
      `Domovik runtime is running on http://127.0.0.1:${environmentConfiguration.port}\n`
    );
  });
  return server;
}

async function handleChatRequest(body) {
  const requestStartedAt = Date.now();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    createHttpError(400, "Please enter a prompt.");
  }

  const conversationHistory = normalizeConversationHistory(body.conversationHistory);
  const screenshotDataUrl = typeof body.screenshotDataUrl === "string" ? body.screenshotDataUrl : "";
  const roiSelections = normalizeRoiSelections(body.roiSelections);
  const requestedSearch = normalizeSearchRequest(body.search);
  const requestedModeHint = typeof body.modeHint === "string" ? body.modeHint.trim().toLowerCase() : "";
  const requestsAgenticRecheck = body.agenticRecheck === true;
  const backendRoutingState = buildBackendRoutingState();
  const routingDecision = resolveTurnRouting({
    hasVisualContext: Boolean(screenshotDataUrl),
    backendRoutingState,
    modeHint: requestedModeHint,
    agenticRecheck: requestsAgenticRecheck
  });
  const wantsVision = routingDecision.usesVisualContext;
  const requestedMode = routingDecision.mode;
  const requestDebug = {
    screenshotPresent: Boolean(screenshotDataUrl),
    screenshotLength: screenshotDataUrl ? screenshotDataUrl.length : 0,
    roiCount: roiSelections.length,
    searchMode: requestedSearch.mode,
    modeHint: requestedModeHint || "",
    agenticRecheck: requestsAgenticRecheck,
    resolvedMode: requestedMode
  };

  if (wantsVision && screenshotDataUrl) {
    const visionDebugPaths = await saveVisionDebugArtifacts({
      screenshotDataUrl,
      roiSelections,
      prompt,
      requestedMode
    });
    requestDebug.visionDebugDirectory = visionDebugPaths.directoryPath;
    requestDebug.visionDebugFullImagePath = visionDebugPaths.fullImagePath;
    requestDebug.visionDebugRoiPaths = visionDebugPaths.roiPaths;
  }

  if (wantsVision && shouldRequireRoiForExactReading(prompt, roiSelections)) {
    const plainReply = [
      "I can't reliably read an exact value from a full-screen screenshot here.",
      "Please provide a tight ROI or close-up around the text you want read exactly.",
      "Without that, I may hallucinate numbers or units."
    ].join(" ");
    runtimeState.lastInteractionMode = requestedMode;
    return buildChatResponse({
      mode: "vision_roi_required",
      plainReply,
      rawReply: plainReply,
      startedAt: requestStartedAt,
      routingDecision,
      debug: requestDebug
    });
  }

  if (!wantsVision && shouldGuardMissingCurrentVisualContext(prompt)) {
    const plainReply = [
      "there isn't a current screenshot attached right now.",
      "capture a screen first if you want me to inspect the current image.",
      "if you mean the previous screenshot, ask about the previous image explicitly."
    ].join(" ");
    runtimeState.lastInteractionMode = "text";
    return buildChatResponse({
      mode: "visual_context_missing",
      plainReply,
      rawReply: plainReply,
      startedAt: requestStartedAt,
      routingDecision,
      debug: requestDebug
    });
  }

  const selfKnowledgeReply = answerSelfKnowledgeQuestion(prompt);
  if (selfKnowledgeReply) {
    runtimeState.lastInteractionMode = "local_identity";
    return buildChatResponse({
      mode: "local_identity",
      plainReply: selfKnowledgeReply,
      rawReply: selfKnowledgeReply,
      startedAt: requestStartedAt,
      debug: requestDebug
    });
  }

  if (isCodexTriggered(prompt)) {
    const cleanedPrompt = removeCodexTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "After the Codex trigger, include what Codex should do.");
    }

    const imagePaths = shouldAttachScreens(prompt) && screenshotDataUrl
      ? [await saveBrowserScreenshot(screenshotDataUrl, "codex")]
      : [];
    const result = await runCodex(environmentConfiguration, cleanedPrompt, imagePaths);
    runtimeState.lastInteractionMode = "handoff";
    return buildChatResponse({
      mode: "codex",
      plainReply: "codex session completed",
      rawReply: "codex session completed",
      outputFilePath: result.outputFilePath,
      startedAt: requestStartedAt,
      debug: requestDebug
    });
  }

  if (isClaudeCodeTriggered(prompt)) {
    const cleanedPrompt = removeClaudeCodeTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "After the Claude Code trigger, include what Claude Code should do.");
    }

    const result = await runClaudeCode(environmentConfiguration, cleanedPrompt);
    runtimeState.lastInteractionMode = "handoff";
    return buildChatResponse({
      mode: "claude-code",
      plainReply: "claude code session completed",
      rawReply: "claude code session completed",
      outputFilePath: result.outputFilePath,
      startedAt: requestStartedAt,
      debug: requestDebug
    });
  }

  if (isOpenClawTriggered(prompt)) {
    const cleanedPrompt = removeOpenClawTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "After the OpenClaw trigger, include what OpenClaw should do.");
    }

    const result = await runOpenClaw(environmentConfiguration, cleanedPrompt);
    runtimeState.lastInteractionMode = "handoff";
    return buildChatResponse({
      mode: "openclaw",
      plainReply: result.responseText || "openclaw session completed",
      rawReply: result.responseText || "openclaw session completed",
      outputFilePath: result.outputFilePath,
      startedAt: requestStartedAt,
      debug: requestDebug
    });
  }

  if (wantsVision && !backendRoutingState.visionBackendAvailable) {
    const plainReply = buildVisionUnavailableReply(backendRoutingState);
    runtimeState.lastInteractionMode = requestedMode;
    return buildChatResponse({
      mode: "vision_unavailable",
      plainReply,
      rawReply: plainReply,
      startedAt: requestStartedAt,
      routingDecision,
      debug: requestDebug
    });
  }

  const searchDecision = resolveSearchDecision(prompt, requestedSearch);
  let searchResult = null;
  let searchFinalAnswer = "";
  let providerPrompt = prompt;

  if (searchDecision.enabled) {
    requestDebug.searchInitialQuery = searchDecision.query;
    try {
      const searchRun = await runSearchAgentTurn({
        userGoal: prompt,
        conversationHistory,
        initialQuery: searchDecision.query,
        mode: searchDecision.mode,
        startedAt: requestStartedAt
      });
      searchResult = searchRun.searchResult;
      searchFinalAnswer = String(searchRun.finalAnswer || "").trim();
      runtimeState.lastSearch = buildSearchStatus(searchResult);
      const searchDebugPath = await saveSearchDebugArtifacts({
        prompt,
        searchDecision,
        searchRun
      });
      providerPrompt = buildWebSearchPromptEnvelope({
        userPrompt: prompt,
        searchQuery: searchResult.query,
        searchResults: formatSearchResultsForPrompt(searchResult)
      });
      requestDebug.searchResultCount = searchResult.resultCount;
      requestDebug.searchSteps = searchResult.stepCount || 1;
      requestDebug.searchQuery = searchResult.query;
      requestDebug.searchFinalQuery = searchResult.query;
      requestDebug.searchDebugPath = searchDebugPath;
      requestDebug.searchBackend = searchRun.backend || "classic";
    } catch (error) {
      runtimeState.lastSearch = buildSearchFailureStatus(searchDecision, error);
      try {
        const failedSearchRun = {
          finalAnswer: "",
          searchResult: runtimeState.lastSearch,
          searches: Array.isArray(error?.searches) ? error.searches : [],
          backend: requestDebug.searchBackend || "classic",
          failed: true,
          error: String(error?.message || error || ""),
          debugTrace: Array.isArray(error?.debugTrace) ? error.debugTrace : []
        };
        requestDebug.searchDebugPath = await saveSearchDebugArtifacts({
          prompt,
          searchDecision,
          searchRun: failedSearchRun
        });
      } catch (_artifactError) {
        // Keep the original search error as the user-facing failure.
      }
      const plainReply = buildSearchUnavailableReply(error, searchDecision);
      return buildChatResponse({
        mode: "search_unavailable",
        plainReply,
        rawReply: plainReply,
        startedAt: requestStartedAt,
        routingDecision,
        searchResult: runtimeState.lastSearch,
        debug: requestDebug
      });
    }
  } else {
    runtimeState.lastSearch = createEmptySearchState();
  }

  if (searchDecision.enabled && !wantsVision && searchFinalAnswer) {
    runtimeState.lastInteractionMode = "text";
    return buildChatResponse({
      mode: "web_search",
      plainReply: stripPointTag(searchFinalAnswer),
      rawReply: searchFinalAnswer,
      startedAt: requestStartedAt,
      routingDecision,
      searchResult,
      debug: requestDebug
    });
  }

  const providerStartedAt = Date.now();
  let reply;
  let rawReply = "";
  let mode = wantsVision ? environmentConfiguration.visionProvider : environmentConfiguration.textProvider;
  try {
    if (wantsVision) {
      runtimeState.visualContextSession = createVisualContextSession({
        fullImageDataUrl: screenshotDataUrl,
        modeHint: requestedMode,
        captureSummary: "browser screenshot attached",
        rois: roiSelections
      });
    }
    if (requestedMode === "agentic_vision") {
      const agenticResult = await runAgenticVisionTurn({
        prompt,
        conversationHistory,
        screenshotDataUrl,
        roiSelections,
        searchResult,
        startedAt: requestStartedAt
      });
      reply = agenticResult.reply;
      rawReply = agenticResult.rawReply;
      mode = "agentic_vision";
      markBackendReachable("vision");
    } else {
      reply = wantsVision
        ? await askVisionProvider({
            prompt: providerPrompt,
            screenshotDataUrl,
            conversationHistory,
            systemPromptOverride:
              environmentConfiguration.visionProvider === "openai_compat"
                ? buildOpenAiCompatibleSystemPrompt({ hasRoi: roiSelections.length > 0 })
                : "",
            roiSelections
          })
        : await askTextProvider({
            prompt: providerPrompt,
            conversationHistory
          });
      rawReply = reply;
      markBackendReachable(wantsVision ? "vision" : "text");
    }
  } catch (error) {
    if (wantsVision && isVisionBackendRuntimeFailure(error)) {
      markBackendUnreachable("vision", error);
      reply = [
        `Screen-aware mode is unavailable right now because the ${describeConfiguredVisionBackendLabel()} backend could not be reached.`,
        "You can still use text-only mode through the configured text backend.",
        "Clear the current screenshot and ask the same question again, or restore the vision backend."
      ].join(" ");
      mode = "vision_unavailable";
    } else if (!wantsVision && isTextBackendRuntimeFailure(error)) {
      markBackendUnreachable("text", error);
      reply = [
        `Text generation is unavailable right now because the ${describeConfiguredTextBackendLabel()} backend could not be reached.`,
        "Check the configured text backend credentials and network path.",
        "If you want, you can temporarily switch TEXT_PROVIDER back to vision_provider."
      ].join(" ");
      mode = "text_unavailable";
    } else {
      throw error;
    }
  }
  runtimeState.lastInteractionMode = requestedMode;
  return buildChatResponse({
    mode,
    plainReply: stripPointTag(reply),
    rawReply: rawReply || reply,
    startedAt: requestStartedAt,
    providerStartedAt,
    routingDecision,
    searchResult,
    debug: requestDebug
  });
}

async function handleTranscriptionRequest(body) {
  const requestStartedAt = Date.now();
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";

  if (!audioBase64) {
    createHttpError(400, "No audio was provided.");
  }

  const audioBuffer = decodeDataUrlOrBase64(audioBase64);
  if (!audioBuffer.length) {
    createHttpError(400, "The audio payload was empty.");
  }

  if (environmentConfiguration.speechToTextProvider === "sherpa_onnx") {
    const transcript = await transcribeWithSherpaOnnx(audioBuffer, mimeType);
    return {
      transcript,
      timings: {
        totalMs: Date.now() - requestStartedAt
      }
    };
  }

  if (environmentConfiguration.speechToTextProvider === "whisper") {
    const transcript = await transcribeWithWhisper(audioBuffer, mimeType);
    return {
      transcript,
      timings: {
        totalMs: Date.now() - requestStartedAt
      }
    };
  }

  if (!environmentConfiguration.elevenLabsApiKey) {
    createHttpError(400, "ELEVENLABS_API_KEY is required for STT.");
  }

  const transcript = await transcribeWithElevenLabs(audioBuffer, mimeType);
  return {
    transcript,
    timings: {
      totalMs: Date.now() - requestStartedAt
    }
  };
}

async function handleTextToSpeechRequest(body) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    createHttpError(400, "No text was provided for TTS.");
  }

  if (environmentConfiguration.textToSpeechProvider === "minimax") {
    if (!environmentConfiguration.miniMaxApiKey || !environmentConfiguration.miniMaxVoiceId) {
      createHttpError(400, "MINIMAX_API_KEY or MINIMAX_VOICE_ID is missing.");
    }
  } else if (!environmentConfiguration.elevenLabsApiKey || !environmentConfiguration.elevenLabsVoiceId) {
    createHttpError(400, "ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID is missing.");
  }

  const audioBuffer = await synthesizeSpeech(text);
  return {
    audioBase64: audioBuffer.toString("base64"),
    mimeType: "audio/mpeg"
  };
}

function buildStatusPayload() {
  const assistantIdentity = getAssistantIdentity();
  const backendRoutingState = buildBackendRoutingState();
  const visualState = buildVisualStatePayload();
  return {
    assistantName: assistantIdentity.name,
    assistantRole: assistantIdentity.role,
    wakePhrase: assistantIdentity.wakePhrase,
    envFilePath,
    port: environmentConfiguration.port,
    textProvider: environmentConfiguration.textProvider,
    visionProvider: environmentConfiguration.visionProvider,
    backendRoutingState,
    backendHealth: runtimeState.backendHealth,
    lastSearch: runtimeState.lastSearch,
    activeMode: runtimeState.lastInteractionMode,
    visualSessionActive: visualState.isActive,
    visualSessionId: visualState.sessionId,
    visualSessionRoiCount: visualState.roiCount,
    visualState,
    miniMaxTextConfigured: Boolean(environmentConfiguration.miniMaxApiKey),
    miniMaxTextBaseUrl: environmentConfiguration.miniMaxTextBaseUrl,
    miniMaxTextModel: environmentConfiguration.miniMaxTextModel,
    anthropicConfigured: Boolean(environmentConfiguration.anthropicApiKey),
    anthropicModel: environmentConfiguration.anthropicModel,
    visionBackendConfigured: Boolean(environmentConfiguration.visionBaseUrl),
    visionBaseUrl: environmentConfiguration.visionBaseUrl,
    visionModel: environmentConfiguration.visionModel,
    visionMaxImages: environmentConfiguration.visionMaxImages,
    tavilyConfigured: Boolean(environmentConfiguration.tavilyApiKey),
    cloudflareAccessConfigured: Boolean(
      environmentConfiguration.visionCfAccessClientId &&
      environmentConfiguration.visionCfAccessClientSecret
    ),
    textToSpeechProvider: environmentConfiguration.textToSpeechProvider,
    elevenLabsConfigured: Boolean(environmentConfiguration.elevenLabsApiKey),
    elevenLabsVoiceConfigured: Boolean(environmentConfiguration.elevenLabsVoiceId),
    miniMaxConfigured: Boolean(environmentConfiguration.miniMaxApiKey),
    miniMaxVoiceConfigured: Boolean(environmentConfiguration.miniMaxVoiceId),
    miniMaxTtsModel: environmentConfiguration.miniMaxTtsModel,
    speechToTextProvider: environmentConfiguration.speechToTextProvider,
    codexCommand: environmentConfiguration.codexCommand,
    claudeCodeCommand: environmentConfiguration.claudeCodeCommand,
    openClawCommand: environmentConfiguration.openClawCommand,
    codexWorkingDirectory: resolveCodexWorkingDirectory(environmentConfiguration),
    codexOutputDirectory: codexOutputRoot
  };
}

function buildVisualStatePayload() {
  return {
    isActive: runtimeState.visualContextSession.isActive,
    sessionId: runtimeState.visualContextSession.sessionId,
    roiCount: runtimeState.visualContextSession.rois.length,
    hasScreenshot: Boolean(runtimeState.visualContextSession.fullImageDataUrl),
    captureSummary: runtimeState.visualContextSession.captureSummary || "",
    modeHint: runtimeState.visualContextSession.modeHint || ""
  };
}

function buildChatResponse({
  mode,
  plainReply,
  rawReply = "",
  startedAt,
  providerStartedAt = null,
  outputFilePath = "",
  routingDecision = null,
  searchResult = null,
  debug = null
}) {
  const timings = {
    totalMs: Date.now() - startedAt
  };
  if (providerStartedAt) {
    timings.providerMs = Date.now() - providerStartedAt;
  }

  const display = buildDisplayReply({
    mode,
    plainText: plainReply,
    timings,
    outputFilePath,
    searchResult,
    searchDebugPath: debug?.searchDebugPath || ""
  });

  return {
    mode,
    reply: display.plainText,
    rawReply: rawReply || display.plainText,
    display,
    timings,
    activeMode: runtimeState.lastInteractionMode,
    visualState: buildVisualStatePayload(),
    ...(routingDecision ? { routing: routingDecision } : {}),
    ...(searchResult ? { search: buildSearchStatus(searchResult) } : {}),
    ...(debug ? { debug } : {}),
    ...(outputFilePath ? { outputFilePath } : {})
  };
}

function buildDisplayReply({
  mode,
  plainText,
  timings,
  outputFilePath = "",
  searchResult = null,
  searchDebugPath = ""
}) {
  const safePlainText = String(plainText || "").trim();
  const displaySuffix = buildDisplaySuffix({ timings, outputFilePath, searchResult, searchDebugPath });
  return {
    mode,
    plainText: safePlainText,
    displayText: displaySuffix ? `${safePlainText}\n\n${displaySuffix}` : safePlainText,
    activityText: buildActivityText({ timings, outputFilePath, searchResult }),
    timings,
    ...(outputFilePath ? { outputFilePath } : {})
  };
}

function buildDisplaySuffix({ timings, outputFilePath = "", searchResult = null, searchDebugPath = "" }) {
  const parts = [];
  const searchSummary = formatSearchSummary(searchResult);
  if (searchSummary) {
    parts.push(`[search: ${searchSummary}]`);
  }
  if (searchDebugPath) {
    parts.push(`[search-log: ${searchDebugPath}]`);
  }
  const timingSummary = formatTimingSummary(timings);
  if (timingSummary) {
    parts.push(`[${timingSummary}]`);
  }
  if (outputFilePath) {
    parts.push(`[log: ${outputFilePath}]`);
  }
  return parts.join("\n");
}

function buildActivityText({ timings, outputFilePath = "", searchResult = null }) {
  const timingSummary = formatTimingSummary(timings);
  const searchPrefix = formatSearchSummary(searchResult);
  if (outputFilePath) {
    return searchPrefix
      ? (timingSummary
          ? `done · search ${searchPrefix} · ${timingSummary} · log: ${outputFilePath}`
          : `done · search ${searchPrefix} · log: ${outputFilePath}`)
      : (timingSummary ? `done · ${timingSummary} · log: ${outputFilePath}` : `done · log: ${outputFilePath}`);
  }
  return searchPrefix
    ? (timingSummary ? `done · search ${searchPrefix} · ${timingSummary}` : `done · search ${searchPrefix}`)
    : (timingSummary ? `done · ${timingSummary}` : "done");
}

function formatSearchSummary(searchResult) {
  if (!searchResult || !searchResult.used) {
    return "";
  }
  const stepCount = Number(searchResult.stepCount || 0);
  const resultCount = Number(searchResult.resultCount || 0);
  const query = String(searchResult.query || "").trim();
  const clippedQuery = query.length > 80 ? `${query.slice(0, 77)}...` : query;
  const parts = [];
  if (stepCount > 0) {
    parts.push(`${stepCount} step${stepCount === 1 ? "" : "s"}`);
  }
  parts.push(`${resultCount} result${resultCount === 1 ? "" : "s"}`);
  if (clippedQuery) {
    parts.push(`query="${clippedQuery}"`);
  }
  return parts.join(" · ");
}

function formatTimingSummary(timings) {
  if (!timings || typeof timings !== "object") {
    return "";
  }

  const parts = [];
  if (Number.isFinite(timings.providerMs)) {
    parts.push(`provider ${formatMilliseconds(timings.providerMs)}`);
  }
  if (Number.isFinite(timings.totalMs)) {
    parts.push(`total ${formatMilliseconds(timings.totalMs)}`);
  }
  return parts.join(" · ");
}

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) {
    return "";
  }
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }
  return `${Math.round(milliseconds)}ms`;
}

function normalizeConversationHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-10)
    .map(normalizeConversationTurn)
    .filter(Boolean);
}

function normalizeConversationTurn(turn) {
  if (!turn || typeof turn !== "object") {
    return null;
  }

  const user = typeof turn.user === "string" ? turn.user.trim() : "";
  const assistant = typeof turn.assistant === "string" ? turn.assistant.trim() : "";
  if (!user && !assistant) {
    return null;
  }

  return {
    user,
    assistant
  };
}

function normalizeRoiSelections(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 4)
    .map((roi, index) => normalizeRoiSelection(roi, index))
    .filter(Boolean);
}

function normalizeRoiSelection(roi, index) {
  if (!roi || typeof roi !== "object") {
    return null;
  }

  const imageDataUrl = typeof roi.imageDataUrl === "string" ? roi.imageDataUrl.trim() : "";
  if (!imageDataUrl) {
    return null;
  }

  const x = Math.max(0, Number(roi.x) || 0);
  const y = Math.max(0, Number(roi.y) || 0);
  const width = Math.max(1, Number(roi.width) || 1);
  const height = Math.max(1, Number(roi.height) || 1);

  return {
    roiId: typeof roi.roiId === "string" && roi.roiId.trim() ? roi.roiId.trim() : `roi-${index + 1}`,
    label: typeof roi.label === "string" && roi.label.trim() ? roi.label.trim() : `roi ${index + 1}`,
    origin: typeof roi.origin === "string" && roi.origin.trim() ? roi.origin.trim() : "manual",
    x,
    y,
    width,
    height,
    imageDataUrl
  };
}

function buildBackendRoutingState() {
  const textConfigured = isTextProviderConfigured();
  const visionConfigured = isVisionProviderConfigured();
  return {
    textProvider: environmentConfiguration.textProvider,
    visionProvider: environmentConfiguration.visionProvider,
    ttsProvider: environmentConfiguration.textToSpeechProvider,
    textBackendConfigured: textConfigured,
    visionBackendConfigured: visionConfigured,
    textBackendAvailable: textConfigured && runtimeState.backendHealth.text.reachable !== false,
    visionBackendAvailable: visionConfigured && runtimeState.backendHealth.vision.reachable !== false,
    activeMode: runtimeState.lastInteractionMode
  };
}

function createBackendHealthState() {
  return {
    reachable: null,
    lastCheckedAt: "",
    lastError: ""
  };
}

function createEmptySearchState() {
  return {
    used: false,
    mode: "none",
    provider: "",
    query: "",
    resultCount: 0,
    stepCount: 0,
    lastRunAt: "",
    error: ""
  };
}

function normalizeSearchRequest(rawSearch) {
  if (!rawSearch || typeof rawSearch !== "object") {
    return { enabled: false, mode: "none" };
  }

  const mode = typeof rawSearch.mode === "string" ? rawSearch.mode.trim().toLowerCase() : "";
  if (mode === "web") {
    return { enabled: true, mode: "web" };
  }

  return { enabled: false, mode: "none" };
}

function resolveSearchDecision(prompt, requestedSearch) {
  if (requestedSearch.enabled) {
    return {
      enabled: true,
      mode: requestedSearch.mode,
      query: prompt
    };
  }

  if (looksLikeExplicitWebSearchRequest(prompt)) {
    return {
      enabled: true,
      mode: "web",
      query: prompt
    };
  }

  return {
    enabled: false,
    mode: "none",
    query: ""
  };
}

async function performSearch(query, options = {}) {
  const mode = String(options.mode || "").trim().toLowerCase();
  if (mode === "web") {
    return searchWeb(query, options);
  }
  if (mode === "docs") {
    return searchDocs(query, options);
  }
  if (mode === "local") {
    return searchLocal(query, options);
  }
  throw new Error(`Unsupported search mode: ${mode || "unknown"}`);
}

async function runAgenticSearchTurn({
  userGoal,
  conversationHistory,
  initialQuery,
  mode = "web",
  startedAt
}) {
  const searches = [];
  let nextQuery = normalizeWebSearchQuery(initialQuery, userGoal);
  let lastPlannerOutput = "";

  for (let stepIndex = 0; stepIndex < environmentConfiguration.agenticMaxCycles; stepIndex += 1) {
    if (Date.now() - startedAt > environmentConfiguration.agenticRuntimeSeconds * 1000) {
      return buildSearchExhaustedResult(userGoal, searches, "time budget reached", lastPlannerOutput);
    }

    const searchStartedAt = Date.now();
    const searchResult = await performSearch(nextQuery, { mode, userGoal });
    const searchDurationMs = Date.now() - searchStartedAt;
    searches.push({
      stepIndex: stepIndex + 1,
      rawQuery: nextQuery,
      normalizedQuery: searchResult.query,
      query: nextQuery,
      result: searchResult,
      searchDurationMs,
      plannerDurationMs: 0
    });

    const plannerStartedAt = Date.now();
    const plannerOutput = await askTextProvider({
      prompt: buildSearchPlannerPrompt({
        userGoal,
        conversationHistory,
        searches,
        remainingSteps: environmentConfiguration.agenticMaxCycles - (stepIndex + 1)
      }),
      conversationHistory: [],
      systemPromptOverride: buildSearchOrchestratorSystemPrompt()
    });
    searches[searches.length - 1].plannerDurationMs = Date.now() - plannerStartedAt;
    lastPlannerOutput = plannerOutput;

    const decision = parseSearchPlannerOutput(plannerOutput);
    if (decision.action === "final" && decision.finalText) {
      return {
        finalAnswer: decision.finalText,
        searchResult: buildAggregatedSearchResult(searches),
        searches
      };
    }

    if (decision.action === "search" && decision.query) {
      nextQuery = normalizeWebSearchQuery(decision.query, userGoal);
      continue;
    }

    return buildSearchExhaustedResult(
      userGoal,
      searches,
      "planner returned an unusable decision",
      lastPlannerOutput
    );
  }

  return buildSearchExhaustedResult(userGoal, searches, "step limit reached", lastPlannerOutput);
}

async function runSearchAgentTurn({
  userGoal,
  conversationHistory,
  initialQuery,
  mode = "web",
  startedAt
}) {
  const classicResult = await runAgenticSearchTurn({
    userGoal,
    conversationHistory,
    initialQuery,
    mode,
    startedAt
  });
  return {
    ...classicResult,
    backend: "classic"
  };
}

async function searchWeb(query, options = {}) {
  if (!environmentConfiguration.tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is missing in linux/.env.");
  }

  const normalizedQuery = normalizeWebSearchQuery(query, options.userGoal || query);
  if (!normalizedQuery) {
    throw new Error("Web search query became empty after normalization.");
  }

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, environmentConfiguration.searchHttpTimeoutSeconds * 1000);

  let response;
  try {
    response = await fetch(tavilySearchUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${environmentConfiguration.tavilyApiKey}`
      },
      body: JSON.stringify({
        query: normalizedQuery,
        topic: "general",
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_favicon: false
      }),
      signal: abortController.signal
    });
  } catch (error) {
    clearTimeout(timeoutHandle);
    if (error?.name === "AbortError") {
      throw new Error(
        `Tavily search timed out after ${environmentConfiguration.searchHttpTimeoutSeconds} seconds.`
      );
    }
    throw error;
  }
  clearTimeout(timeoutHandle);

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Tavily search error (${response.status}): ${responseText}`);
  }

  const parsed = JSON.parse(responseText);
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return {
    used: true,
    mode: "web",
    provider: "tavily",
    query: String(parsed.query || normalizedQuery).trim(),
    answer: typeof parsed.answer === "string" ? parsed.answer.trim() : "",
    results: results
      .map((entry) => ({
        title: typeof entry?.title === "string" ? entry.title.trim() : "",
        url: typeof entry?.url === "string" ? entry.url.trim() : "",
        content: typeof entry?.content === "string" ? entry.content.trim() : "",
        score: Number.isFinite(entry?.score) ? entry.score : null
      }))
      .filter((entry) => entry.title || entry.url || entry.content),
    resultCount: results.length,
    stepCount: 1,
    lastRunAt: new Date().toISOString(),
    error: ""
  };
}

async function searchDocs(_query, _options = {}) {
  throw new Error("searchDocs is not implemented yet.");
}

async function searchLocal(_query, _options = {}) {
  throw new Error("searchLocal is not implemented yet.");
}

function formatSearchResultsForPrompt(searchResult) {
  const resultLines = (searchResult.results || []).map((entry, index) => {
    const parts = [
      `${index + 1}. ${entry.title || "untitled result"}`,
      entry.url ? `url: ${entry.url}` : "",
      entry.content ? `snippet: ${entry.content}` : ""
    ].filter(Boolean);
    return parts.join("\n");
  });

  if (!resultLines.length) {
    return "no search results were returned.";
  }

  return resultLines.join("\n\n");
}

function buildWebSearchPromptEnvelope({ userPrompt, searchQuery, searchResults }) {
  return renderPrompt("webSearchPromptEnvelope", {
    userPrompt,
    searchQuery,
    searchResults
  });
}

function buildSearchOrchestratorSystemPrompt() {
  return renderPrompt("searchOrchestratorSystemPrompt", {
    assistantName: getAssistantIdentity().name,
    maxSearchSteps: environmentConfiguration.agenticMaxCycles
  });
}

function buildSearchPlannerPrompt({ userGoal, conversationHistory, searches, remainingSteps }) {
  const historyText = conversationHistory.length
    ? conversationHistory
        .map((turn, index) => `${index + 1}. user: ${turn.user}\n   assistant: ${turn.assistant}`)
        .join("\n")
    : "none";
  const searchContext = searches.length
    ? searches
        .map((entry) => {
          const formatted = formatSearchResultsForPrompt(entry.result);
          return `step ${entry.stepIndex}\nquery: ${entry.query}\nresults:\n${formatted}`;
        })
        .join("\n\n")
    : "none";

  return renderPrompt("searchPlannerPrompt", {
    userGoal,
    conversationHistory: historyText,
    searchContext,
    remainingSteps
  });
}

function parseSearchPlannerOutput(plannerOutput) {
  const text = String(plannerOutput || "").trim();
  const actionMatch = text.match(/ACTION:\s*(search|final)/i);
  if (!actionMatch) {
    return { action: "", query: "", finalText: "" };
  }

  const action = actionMatch[1].toLowerCase();
  if (action === "search") {
    const queryMatch = text.match(/QUERY:\s*([\s\S]+)/i);
    return {
      action,
      query: queryMatch ? queryMatch[1].trim() : "",
      finalText: ""
    };
  }

  const finalMatch = text.match(/FINAL:\s*([\s\S]+)/i);
  return {
    action,
    query: "",
    finalText: finalMatch ? finalMatch[1].trim() : ""
  };
}

function buildAggregatedSearchResult(searches) {
  const latest = searches.length ? searches[searches.length - 1].result : createEmptySearchState();
  const seenUrls = new Set();
  const mergedResults = [];
  for (const entry of searches) {
    for (const result of entry.result.results || []) {
      const dedupeKey = result.url || `${result.title}|${result.content}`;
      if (seenUrls.has(dedupeKey)) {
        continue;
      }
      seenUrls.add(dedupeKey);
      mergedResults.push(result);
    }
  }

  return {
    used: true,
    mode: latest.mode || "web",
    provider: latest.provider || "tavily",
    query: latest.query || searches[0]?.query || "",
    answer: latest.answer || "",
    results: mergedResults,
    resultCount: mergedResults.length,
    stepCount: searches.length,
    lastRunAt: latest.lastRunAt || new Date().toISOString(),
    error: ""
  };
}

function buildSearchExhaustedResult(userGoal, searches, reason, plannerOutput = "") {
  const searchResult = buildAggregatedSearchResult(searches);
  const reply = renderPrompt("searchExhaustedReply", {
    reason,
    userGoal,
    lastSearchSummary: formatSearchResultsForPrompt(searchResult)
  });
  return {
    finalAnswer: reply,
    searchResult,
    searches
  };
}

async function saveSearchDebugArtifacts({ prompt, searchDecision, searchRun }) {
  const directoryPath = path.join(searchDebugRoot, `search-${Date.now()}-${randomUUID().slice(0, 8)}`);
  ensureDirectorySync(directoryPath);

  const debugPayload = {
    source: "runtime-agentic-search",
    prompt,
    requestedSearchMode: searchDecision.mode,
    initialQuery: searchDecision.query,
    failed: Boolean(searchRun.failed),
    backend: searchRun.backend || "",
    error: searchRun.error || "",
    finalAnswer: searchRun.finalAnswer,
    aggregatedSearch: searchRun.searchResult,
    debugTrace: Array.isArray(searchRun.debugTrace) ? searchRun.debugTrace : [],
    steps: Array.isArray(searchRun.searches)
      ? searchRun.searches.map((entry) => ({
          stepIndex: entry.stepIndex,
          rawQuery: entry.rawQuery || entry.query,
          normalizedQuery: entry.normalizedQuery || entry.result?.query || "",
          searchDurationMs: entry.searchDurationMs || 0,
          plannerDurationMs: entry.plannerDurationMs || 0,
          resultCount: entry.result?.resultCount || 0,
          results: (entry.result?.results || []).map((result) => ({
            title: result.title,
            url: result.url,
            content: result.content
          }))
        }))
      : []
  };

  const debugPath = path.join(directoryPath, "search-debug.json");
  await fsp.writeFile(debugPath, JSON.stringify(debugPayload, null, 2), "utf8");
  return debugPath;
}

function buildSearchStatus(searchResult) {
  return {
    used: Boolean(searchResult?.used),
    mode: searchResult?.mode || "none",
    provider: searchResult?.provider || "",
    query: searchResult?.query || "",
    resultCount: searchResult?.resultCount || 0,
    stepCount: searchResult?.stepCount || 0,
    lastRunAt: searchResult?.lastRunAt || "",
    error: searchResult?.error || ""
  };
}

function buildSearchFailureStatus(searchDecision, error) {
  return {
    used: true,
    mode: searchDecision.mode,
    provider: "tavily",
    query: searchDecision.query,
    resultCount: 0,
    stepCount: 0,
    lastRunAt: new Date().toISOString(),
    error: String(error?.message || error || "")
  };
}

function buildSearchUnavailableReply(error, searchDecision) {
  const searchModeLabel = searchDecision.mode === "web" ? "web search" : "search";
  const errorText = String(error?.message || error || "unknown search error");
  if (errorText.toLowerCase().includes("query is too long")) {
    return [
      `${searchModeLabel} failed because the generated Tavily query was too long.`,
      "The runtime should shorten or simplify the search query before retrying."
    ].join(" ");
  }
  return [
    `${searchModeLabel} is unavailable right now.`,
    errorText,
    "Check TAVILY_API_KEY and the runtime network path, then try again."
  ].join(" ");
}

function normalizeWebSearchQuery(query, fallbackText = "") {
  const sourceText = String(query || "").trim() || String(fallbackText || "").trim();
  if (!sourceText) {
    return "";
  }

  const lines = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^action\s*:/i.test(line))
    .filter((line) => !/^final\s*:/i.test(line))
    .filter((line) => !/^question\s*:/i.test(line))
    .filter((line) => !/^query\s*:/i.test(line));

  let normalized = lines.join(" ");
  normalized = normalized
    .replace(/\s+/g, " ")
    .replace(/\b(search the web for|search web for|web search for)\b/gi, "")
    .replace(/\b(please|could you|can you)\b/gi, "")
    .trim();

  if (!normalized) {
    normalized = String(fallbackText || "").trim();
  }

  if (normalized.length <= maxTavilyQueryLength) {
    return normalized;
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const firstSentence = sentences[0] || normalized;
  if (firstSentence.length <= maxTavilyQueryLength) {
    return firstSentence;
  }

  return firstSentence.slice(0, maxTavilyQueryLength).trim();
}

function looksLikeExplicitWebSearchRequest(prompt) {
  const normalizedPrompt = normalizeForIntentMatching(prompt);
  return matchesAnyIntent(normalizedPrompt, [
    "search the web",
    "search web",
    "web search",
    "search online",
    "look it up",
    "look this up",
    "find on the web",
    "find online",
    "найди в интернете",
    "найди в сети",
    "поищи в интернете",
    "поищи в сети",
    "ищи в интернете",
    "ищи в сети",
    "поищи онлайн",
    "suche im web",
    "suche online",
    "such im web",
    "such online"
  ]);
}

function markBackendReachable(kind) {
  if (!runtimeState.backendHealth[kind]) {
    return;
  }
  runtimeState.backendHealth[kind] = {
    reachable: true,
    lastCheckedAt: new Date().toISOString(),
    lastError: ""
  };
}

function markBackendUnreachable(kind, error) {
  if (!runtimeState.backendHealth[kind]) {
    return;
  }
  runtimeState.backendHealth[kind] = {
    reachable: false,
    lastCheckedAt: new Date().toISOString(),
    lastError: String(error?.message || error || "")
  };
}

function resolveTurnRouting({ hasVisualContext, backendRoutingState, modeHint = "", agenticRecheck = false }) {
  if (hasVisualContext) {
    const wantsAgentic = agenticRecheck || modeHint === "agentic_vision";
    return {
      mode: wantsAgentic ? "agentic_vision" : "direct_vision",
      usesVisualContext: true,
      textProvider: backendRoutingState.textProvider,
      visionProvider: backendRoutingState.visionProvider,
      effectiveProvider: backendRoutingState.visionProvider,
      textBackendAvailable: backendRoutingState.textBackendAvailable,
      visionBackendAvailable: backendRoutingState.visionBackendAvailable
    };
  }

  return {
    mode: "text",
    usesVisualContext: false,
    textProvider: backendRoutingState.textProvider,
    visionProvider: backendRoutingState.visionProvider,
    effectiveProvider: backendRoutingState.textProvider,
    textBackendAvailable: backendRoutingState.textBackendAvailable,
    visionBackendAvailable: backendRoutingState.visionBackendAvailable
  };
}

function buildVisionUnavailableReply(backendRoutingState) {
  return [
    `Screen-aware mode is not available right now because the configured vision backend (${describeConfiguredVisionBackendLabel()}) is unavailable.`,
    `Text-only mode is still available through ${describeConfiguredTextBackendLabel()}.`,
    "Remove the screenshot and ask the same question as plain text."
  ].join(" ");
}

function describeConfiguredTextBackendLabel() {
  if (environmentConfiguration.textProvider === "minimax") {
    return environmentConfiguration.miniMaxTextModel;
  }
  return describeConfiguredVisionBackendLabel();
}

function describeConfiguredVisionBackendLabel() {
  if (environmentConfiguration.visionProvider === "openai_compat") {
    return environmentConfiguration.visionModel;
  }
  return environmentConfiguration.anthropicModel;
}

function createEmptyVisualContextSession() {
  return {
    sessionId: "",
    fullImageDataUrl: "",
    captureSummary: "",
    capturedAt: "",
    modeHint: "direct_vision",
    rois: [],
    cvHints: [],
    isActive: false
  };
}

function createVisualContextSession({
  fullImageDataUrl,
  captureSummary = "",
  modeHint = "direct_vision",
  rois = []
}) {
  const cvHints = collectVisualAugmentationHints({
    fullImageDataUrl,
    rois,
    modeHint
  });
  return {
    sessionId: randomUUID(),
    fullImageDataUrl,
    captureSummary,
    capturedAt: new Date().toISOString(),
    modeHint,
    rois,
    cvHints,
    isActive: Boolean(fullImageDataUrl)
  };
}

function collectVisualAugmentationHints({ fullImageDataUrl = "", rois = [], modeHint = "direct_vision" }) {
  const providers = getConfiguredVisualAugmentationProviders();
  if (!providers.length || !fullImageDataUrl) {
    return [];
  }

  return providers.map((provider) => ({
    provider,
    status: "not_invoked",
    appliesTo: rois.length > 0 ? "screenshot_and_roi" : "screenshot",
    modeHint
  }));
}

function getConfiguredVisualAugmentationProviders() {
  return String(environmentConfiguration.visualAugmentationProviders || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function clearVisualContextSession() {
  runtimeState.visualContextSession = createEmptyVisualContextSession();
  if (runtimeState.lastInteractionMode === "direct_vision" || runtimeState.lastInteractionMode === "agentic_vision") {
    runtimeState.lastInteractionMode = "text";
  }
}

async function runAgenticVisionTurn({
  prompt,
  conversationHistory,
  screenshotDataUrl,
  roiSelections = [],
  searchResult = null,
  startedAt
}) {
  const observations = [];
  let nextInspectionQuestion = buildInitialInspectionQuestion(prompt, roiSelections.length > 0);
  let lastPlannerOutput = "";

  for (let stepIndex = 0; stepIndex < environmentConfiguration.agenticMaxCycles; stepIndex += 1) {
    if (Date.now() - startedAt > environmentConfiguration.agenticRuntimeSeconds * 1000) {
      return buildAgenticExhaustedResult(prompt, observations, "time budget reached");
    }

    const observationText = await askVisionProvider({
      prompt: nextInspectionQuestion,
      screenshotDataUrl,
      conversationHistory: [],
      systemPromptOverride: buildVisualInspectorSystemPrompt({ hasRoi: roiSelections.length > 0 }),
      roiSelections
    });
    observations.push({
      stepIndex: stepIndex + 1,
      question: nextInspectionQuestion,
      observation: observationText
    });

    const plannerOutput = await askTextProvider({
      prompt: buildAgenticPlannerPrompt({
        userGoal: prompt,
        conversationHistory,
        searchResult,
        observations,
        remainingSteps: environmentConfiguration.agenticMaxCycles - (stepIndex + 1)
      }),
      conversationHistory: [],
      systemPromptOverride: buildAgenticOrchestratorSystemPrompt({
        hasRoi: roiSelections.length > 0
      })
    });
    lastPlannerOutput = plannerOutput;

    const decision = parseAgenticPlannerOutput(plannerOutput);
    if (decision.action === "final" && decision.finalText) {
      return {
        reply: decision.finalText,
        rawReply: JSON.stringify({ observations, plannerOutput }, null, 2)
      };
    }

    if (decision.action === "inspect" && decision.question) {
      nextInspectionQuestion = decision.question;
      continue;
    }

    return buildAgenticExhaustedResult(prompt, observations, "planner returned an unusable decision", lastPlannerOutput);
  }

  return buildAgenticExhaustedResult(prompt, observations, "step limit reached", lastPlannerOutput);
}

function buildInitialInspectionQuestion(userGoal, hasRoi = false) {
  return renderPrompt("initialInspectionQuestion", {
    userGoal,
    roiInspectionBlock: hasRoi ? getPromptTemplate("roiInspectionBlock") : ""
  });
}

function buildAgenticPlannerPrompt({ userGoal, conversationHistory, searchResult = null, observations, remainingSteps }) {
  const historyText = conversationHistory.length
    ? conversationHistory
        .map((turn, index) => `${index + 1}. user: ${turn.user}\n   assistant: ${turn.assistant}`)
        .join("\n")
    : "none";
  const searchContextText = searchResult?.used
    ? formatSearchResultsForPrompt(searchResult)
    : "";
  const observationText = observations.length
    ? observations
        .map(
          (entry) => `step ${entry.stepIndex}\nquestion: ${entry.question}\nobservation: ${entry.observation}`
        )
        .join("\n\n")
    : "none";

  return renderPrompt("agenticPlannerPrompt", {
    userGoal,
    conversationHistory: historyText,
    searchContextBlock: searchContextText ? `\nweb search context:\n${searchContextText}\n\n` : "\n",
    observations: observationText,
    remainingSteps
  });
}

function parseAgenticPlannerOutput(plannerOutput) {
  const text = String(plannerOutput || "").trim();
  const actionMatch = text.match(/ACTION:\s*(inspect|final)/i);
  if (!actionMatch) {
    return { action: "", question: "", finalText: "" };
  }

  const action = actionMatch[1].toLowerCase();
  if (action === "inspect") {
    const questionMatch = text.match(/QUESTION:\s*([\s\S]+)/i);
    return {
      action,
      question: questionMatch ? questionMatch[1].trim() : "",
      finalText: ""
    };
  }

  const finalMatch = text.match(/FINAL:\s*([\s\S]+)/i);
  return {
    action,
    question: "",
    finalText: finalMatch ? finalMatch[1].trim() : ""
  };
}

function buildAgenticExhaustedResult(userGoal, observations, reason, plannerOutput = "") {
  const lastObservation = observations.length
    ? observations[observations.length - 1].observation
    : "no grounded visual observations were collected.";
  const reply = renderPrompt("agenticExhaustedReply", {
    reason,
    userGoal,
    lastObservation
  });

  return {
    reply,
    rawReply: JSON.stringify({ observations, reason, plannerOutput }, null, 2)
  };
}

function buildOpenAiCompatibleSystemPrompt({ hasRoi = false } = {}) {
  return renderPrompt("visionSystemPrompt", {
    companionPrompt: buildCompanionPrompt(),
    assistantName: getAssistantIdentity().name,
    visionModel: environmentConfiguration.visionModel,
    roiPolicyBlock: hasRoi ? getPromptTemplate("roiPolicyBlock") : ""
  });
}

function buildOpenAiCompatibleTextOnlySystemPrompt() {
  return renderPrompt("visionTextOnlySystemPrompt", {
    companionPrompt: buildCompanionPrompt(),
    assistantName: getAssistantIdentity().name,
    visionModel: environmentConfiguration.visionModel
  });
}

function buildMiniMaxTextSystemPrompt() {
  return renderPrompt("miniMaxTextSystemPrompt", {
    companionPrompt: buildCompanionPrompt(),
    assistantName: getAssistantIdentity().name,
    textModel: environmentConfiguration.miniMaxTextModel
  });
}

function buildAgenticOrchestratorSystemPrompt({ hasRoi = false } = {}) {
  return renderPrompt("agenticOrchestratorSystemPrompt", {
    assistantName: getAssistantIdentity().name,
    maxAgenticVisionSteps: environmentConfiguration.agenticMaxCycles,
    roiPolicyBlock: hasRoi ? getPromptTemplate("roiPolicyBlock") : ""
  });
}

function buildVisualInspectorSystemPrompt({ hasRoi = false } = {}) {
  return renderPrompt("visualInspectorSystemPrompt", {
    assistantName: getAssistantIdentity().name,
    roiPolicyBlock: hasRoi ? getPromptTemplate("roiPolicyBlock") : ""
  });
}

function buildScreenshotGroundingInstruction({ hasRoi = false } = {}) {
  return renderPrompt("screenshotGroundingInstruction", {
    roiPolicyBlock: hasRoi ? getPromptTemplate("roiPolicyBlock") : ""
  });
}

function answerSelfKnowledgeQuestion(prompt) {
  if (!prompt) {
    return "";
  }

  const identity = getAssistantIdentity();
  const normalizedPrompt = normalizeForIntentMatching(prompt);
  const asksIdentity = matchesAnyIntent(normalizedPrompt, [
    "who are you",
    "what are you",
    "what is your name",
    "your name",
    "who am i talking to",
    "кто ты",
    "как тебя зовут",
    "что ты",
    "wie heisst du",
    "wie heißt du",
    "wer bist du",
    "was bist du"
  ]);
  const asksProvider = matchesAnyIntent(normalizedPrompt, [
    "what model",
    "which model",
    "what provider",
    "which provider",
    "what backend",
    "which backend",
    "where are you running",
    "where do you run",
    "what are you running on",
    "какая модель",
    "какой провайдер",
    "какой бекенд",
    "на чем ты работаешь",
    "где ты запущен",
    "где ты работаешь",
    "welches modell",
    "welcher provider",
    "welches backend",
    "wo laeufst du",
    "wo läufst du"
  ]);
  const asksCutoff = matchesAnyIntent(normalizedPrompt, [
    "training data",
    "knowledge cutoff",
    "training cutoff",
    "when were you trained",
    "how recent are your training data",
    "how fresh are your training data",
    "насколько свежие у тебя тренировочные данные",
    "тренировочные данные",
    "дата обучения",
    "катофф",
    "cutoff",
    "wissensstand",
    "trainingsdaten",
    "bis wann",
    "datenstand"
  ]);

  if (!asksIdentity && !asksProvider && !asksCutoff) {
    return "";
  }

  const replyParts = [];

  if (asksIdentity) {
    replyParts.push(`i'm ${identity.name}, your ${identity.role} in this linux runtime.`);
  }

  if (asksProvider) {
    replyParts.push(describeConfiguredProvider(identity.name));
  }

  if (asksCutoff) {
    replyParts.push(describeTrainingCutoff());
  }

  return replyParts.join(" ").trim();
}

function describeConfiguredProvider(assistantName) {
  if (environmentConfiguration.textProvider === "minimax") {
    return `right now ${assistantName} is using ${environmentConfiguration.miniMaxTextModel} for text-only requests, and ${describeVisionProvider()}.`;
  }

  if (environmentConfiguration.visionProvider === "openai_compat") {
    return `right now ${assistantName} is using ${environmentConfiguration.visionModel} through your configured vision runtime.`;
  }

  return `right now ${assistantName} is using ${environmentConfiguration.anthropicModel} through the configured anthropic api.`;
}

function describeTrainingCutoff() {
  return "i don't know the exact training cutoff from runtime context, so i won't invent one.";
}

function describeVisionProvider() {
  if (environmentConfiguration.visionProvider === "openai_compat") {
    if (environmentConfiguration.visionBaseUrl) {
      return `${environmentConfiguration.visionModel} for screenshot-aware requests through your configured vision runtime`;
    }
    return "no screenshot-aware vision backend is currently configured";
  }

  if (environmentConfiguration.anthropicApiKey) {
    return `${environmentConfiguration.anthropicModel} for screenshot-aware requests through the configured anthropic api`;
  }

  return "no screenshot-aware vision backend is currently configured";
}

function isTextProviderConfigured() {
  if (environmentConfiguration.textProvider === "minimax") {
    return Boolean(environmentConfiguration.miniMaxApiKey);
  }

  return isVisionProviderConfigured();
}

function isVisionProviderConfigured() {
  if (environmentConfiguration.visionProvider === "openai_compat") {
    return Boolean(environmentConfiguration.visionBaseUrl);
  }

  return Boolean(environmentConfiguration.anthropicApiKey);
}

function isVisionBackendRuntimeFailure(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("openai-compatible error") ||
    message.includes("anthropic error") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("timed out")
  );
}

function isTextBackendRuntimeFailure(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("minimax text error") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("timed out")
  );
}

async function askVisionProvider({
  prompt,
  screenshotDataUrl,
  conversationHistory,
  systemPromptOverride = "",
  roiSelections = []
}) {
  if (environmentConfiguration.visionProvider === "openai_compat") {
    if (!environmentConfiguration.visionBaseUrl) {
      createHttpError(400, "VISION_BASE_URL is missing in linux/.env.");
    }
    return askVisionBackend({
      prompt,
      screenshotDataUrl,
      conversationHistory,
      systemPromptOverride,
      roiSelections
    });
  }

  if (!environmentConfiguration.anthropicApiKey) {
    createHttpError(400, "ANTHROPIC_API_KEY is missing in linux/.env.");
  }

  return askAnthropic({
    prompt,
    screenshotDataUrl,
    conversationHistory,
    systemPromptOverride,
    roiSelections
  });
}

async function askTextProvider({ prompt, conversationHistory, systemPromptOverride = "" }) {
  if (environmentConfiguration.textProvider === "minimax") {
    if (!environmentConfiguration.miniMaxApiKey) {
      createHttpError(400, "MINIMAX_API_KEY is missing in linux/.env.");
    }

    return askMiniMaxText({
      prompt,
      conversationHistory,
      systemPromptOverride
    });
  }

  return askVisionProvider({
    prompt,
    screenshotDataUrl: "",
    conversationHistory,
    systemPromptOverride: systemPromptOverride || buildOpenAiCompatibleTextOnlySystemPrompt()
  });
}

async function askMiniMaxText({ prompt, conversationHistory, systemPromptOverride = "" }) {
  const messages = [
    {
      role: "system",
      name: getAssistantIdentity().name,
      content: systemPromptOverride || buildMiniMaxTextSystemPrompt()
    }
  ];

  for (const turn of conversationHistory) {
    if (turn && typeof turn.user === "string" && turn.user.trim()) {
      messages.push({
        role: "user",
        name: "User",
        content: turn.user.trim()
      });
    }
    if (turn && typeof turn.assistant === "string" && turn.assistant.trim()) {
      messages.push({
        role: "assistant",
        name: getAssistantIdentity().name,
        content: turn.assistant.trim()
      });
    }
  }

  messages.push({
    role: "user",
    name: "User",
    content: prompt
  });

  const endpointUrl = new URL(
    miniMaxTextChatPath,
    ensureTrailingSlash(environmentConfiguration.miniMaxTextBaseUrl)
  ).toString();

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${environmentConfiguration.miniMaxApiKey}`
    },
    body: JSON.stringify({
      model: environmentConfiguration.miniMaxTextModel,
      messages,
      stream: false,
      temperature: 0.2,
      max_completion_tokens: 1024
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`MiniMax text error (${response.status}): ${responseText}`);
  }

  const parsed = JSON.parse(responseText);
  if (parsed?.base_resp?.status_code && parsed.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax text error (${parsed.base_resp.status_code}): ${
        parsed.base_resp.status_msg || "unknown error"
      }`
    );
  }

  const replyText = normalizeOpenAiCompatibleContent(parsed?.choices?.[0]?.message?.content);
  if (!replyText) {
    throw new Error("MiniMax text backend returned an empty response.");
  }

  return replyText;
}

async function askAnthropic({
  prompt,
  screenshotDataUrl,
  conversationHistory,
  systemPromptOverride = "",
  roiSelections = []
}) {
  const messages = [];

  for (const turn of conversationHistory) {
    if (turn && typeof turn.user === "string" && turn.user.trim()) {
      messages.push({
        role: "user",
        content: turn.user.trim()
      });
    }
    if (turn && typeof turn.assistant === "string" && turn.assistant.trim()) {
      messages.push({
        role: "assistant",
        content: turn.assistant.trim()
      });
    }
  }

  const content = [];
  if (screenshotDataUrl) {
    const imagePayload = parseImageDataUrl(screenshotDataUrl);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imagePayload.mediaType,
        data: imagePayload.base64
      }
    });
    content.push({
      type: "text",
      text: "the user's current linux screenshot"
    });
    content.push({
      type: "text",
      text: buildScreenshotGroundingInstruction({ hasRoi: roiSelections.length > 0 })
    });
  }

  for (const roi of roiSelections) {
    const imagePayload = parseImageDataUrl(roi.imageDataUrl);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imagePayload.mediaType,
        data: imagePayload.base64
      }
    });
    content.push({
      type: "text",
      text: `additional roi "${roi.label}" at ${roi.x},${roi.y} with size ${roi.width}x${roi.height}`
    });
  }

  content.push({
    type: "text",
    text: prompt
  });

  messages.push({
    role: "user",
    content
  });

  const requestBody = {
    model: environmentConfiguration.anthropicModel,
    max_tokens: 1024,
    stream: false,
    system: systemPromptOverride || buildCompanionPrompt(),
    messages
  };

  const response = await fetch(anthropicMessagesUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": environmentConfiguration.anthropicApiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic error (${response.status}): ${responseText}`);
  }

  const parsed = JSON.parse(responseText);
  const textParts = Array.isArray(parsed.content)
    ? parsed.content
        .filter((entry) => entry && entry.type === "text" && typeof entry.text === "string")
        .map((entry) => entry.text.trim())
        .filter(Boolean)
    : [];

  if (!textParts.length) {
    throw new Error("Anthropic returned an empty response.");
  }

  return textParts.join("\n").trim();
}

async function askVisionBackend({
  prompt,
  screenshotDataUrl,
  conversationHistory,
  systemPromptOverride = "",
  roiSelections = []
}) {
  return askVisionBackendChat({
    baseUrl: environmentConfiguration.visionBaseUrl,
    apiKey: environmentConfiguration.visionApiKey,
    model: environmentConfiguration.visionModel,
    systemPrompt:
      systemPromptOverride || buildOpenAiCompatibleSystemPrompt({ hasRoi: roiSelections.length > 0 }),
    prompt,
    screenshotDataUrl,
    conversationHistory,
    roiSelections,
    extraHeaders: {
      "CF-Access-Client-Id": environmentConfiguration.visionCfAccessClientId,
      "CF-Access-Client-Secret": environmentConfiguration.visionCfAccessClientSecret
    }
  });
}

async function askVisionBackendChat({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  prompt,
  screenshotDataUrl,
  conversationHistory,
  roiSelections = [],
  extraHeaders = {}
}) {
  const messages = [
    {
      role: "system",
      content: systemPrompt
    }
  ];

  for (const turn of conversationHistory) {
    if (turn && typeof turn.user === "string" && turn.user.trim()) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: turn.user.trim() }]
      });
    }
    if (turn && typeof turn.assistant === "string" && turn.assistant.trim()) {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: turn.assistant.trim() }]
      });
    }
  }

  const content = [];
  const selectedRoi = roiSelections.length > 0 ? roiSelections[0] : null;
  const canSendFullScreenshotAndRoi =
    environmentConfiguration.visionMaxImages >= 2 &&
    Boolean(screenshotDataUrl) &&
    Boolean(selectedRoi);

  if (canSendFullScreenshotAndRoi && screenshotDataUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: screenshotDataUrl
      }
    });
    content.push({
      type: "text",
      text: [
        "the first image is the user's full linux screenshot.",
        buildScreenshotGroundingInstruction({ hasRoi: true })
      ].join("\n")
    });
  }

  if (selectedRoi) {
    content.push({
      type: "image_url",
      image_url: {
        url: selectedRoi.imageDataUrl
      }
    });
    content.push({
      type: "text",
      text: [
        "the attached image is a cropped roi from the user's current linux screenshot.",
        `roi label: ${selectedRoi.label}.`,
        `roi position in full screenshot: ${selectedRoi.x},${selectedRoi.y}.`,
        `roi size: ${selectedRoi.width}x${selectedRoi.height}.`,
        buildScreenshotGroundingInstruction({ hasRoi: true })
      ].join("\n")
    });
  } else if (screenshotDataUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: screenshotDataUrl
      }
    });
    content.push({
      type: "text",
      text: buildScreenshotGroundingInstruction({ hasRoi: false })
    });
  }

  content.push({
    type: "text",
    text: prompt
  });

  messages.push({
    role: "user",
    content
  });

  const requestBody = {
    model,
    messages,
    max_completion_tokens: 1024,
    stream: false,
    temperature: 0.2
  };

  const headers = {
    "content-type": "application/json"
  };

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  for (const [headerName, headerValue] of Object.entries(extraHeaders)) {
    if (headerValue) {
      headers[headerName] = headerValue;
    }
  }

  const endpointUrl = new URL(
    visionChatCompletionsPath,
    ensureTrailingSlash(baseUrl)
  ).toString();

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI-compatible error (${response.status}): ${responseText}`);
  }

  const parsed = JSON.parse(responseText);
  const normalizedText = normalizeOpenAiCompatibleContent(parsed?.choices?.[0]?.message?.content);

  if (!normalizedText) {
    throw new Error("OpenAI-compatible backend returned an empty response.");
  }

  return normalizedText;
}

async function synthesizeSpeech(text) {
  if (environmentConfiguration.textToSpeechProvider === "minimax") {
    return synthesizeSpeechWithMiniMax(text);
  }

  return synthesizeSpeechWithElevenLabs(text);
}

async function synthesizeSpeechWithElevenLabs(text) {
  const response = await fetch(
    `${elevenLabsTextToSpeechBaseUrl}/${encodeURIComponent(environmentConfiguration.elevenLabsVoiceId)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "audio/mpeg",
        "xi-api-key": environmentConfiguration.elevenLabsApiKey
      },
      body: JSON.stringify({
        text,
        model_id: environmentConfiguration.elevenLabsTtsModel,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    }
  );

  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS error (${response.status}): ${responseBytes.toString("utf8")}`);
  }

  return responseBytes;
}

async function synthesizeSpeechWithMiniMax(text) {
  const response = await fetch(environmentConfiguration.miniMaxTextToSpeechUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${environmentConfiguration.miniMaxApiKey}`
    },
    body: JSON.stringify({
      model: environmentConfiguration.miniMaxTtsModel,
      text,
      stream: false,
      language_boost: "auto",
      output_format: "hex",
      voice_setting: {
        voice_id: environmentConfiguration.miniMaxVoiceId,
        speed: environmentConfiguration.miniMaxVoiceSpeed,
        vol: environmentConfiguration.miniMaxVoiceVolume,
        pitch: environmentConfiguration.miniMaxVoicePitch
      },
      audio_setting: {
        sample_rate: environmentConfiguration.miniMaxAudioSampleRate,
        bitrate: environmentConfiguration.miniMaxAudioBitrate,
        format: "mp3",
        channel: 1
      }
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`MiniMax TTS error (${response.status}): ${responseText}`);
  }

  const parsed = JSON.parse(responseText);
  if (parsed?.base_resp?.status_code !== 0) {
    throw new Error(
      `MiniMax TTS error (${parsed?.base_resp?.status_code ?? "unknown"}): ${
        parsed?.base_resp?.status_msg || "unknown error"
      }`
    );
  }

  const audioHex = typeof parsed?.data?.audio === "string" ? parsed.data.audio.trim() : "";
  if (!audioHex) {
    throw new Error("MiniMax TTS returned empty audio.");
  }

  return Buffer.from(audioHex, "hex");
}

async function transcribeWithElevenLabs(audioBuffer, mimeType) {
  const extension = extensionForMimeType(mimeType);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audioBuffer], { type: mimeType || "audio/webm" }),
    `recording.${extension}`
  );
  formData.append("model_id", environmentConfiguration.elevenLabsSttModel);

  if (environmentConfiguration.whisperLanguage) {
    formData.append("language_code", environmentConfiguration.whisperLanguage);
  }

  for (const keyterm of environmentConfiguration.elevenLabsSpeechKeyterms) {
    formData.append("keyterms[]", keyterm);
  }

  const response = await fetch(elevenLabsSpeechToTextUrl, {
    method: "POST",
    headers: {
      "xi-api-key": environmentConfiguration.elevenLabsApiKey
    },
    body: formData
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs STT error (${response.status}): ${responseText}`);
  }

  const parsed = JSON.parse(responseText);
  const transcript = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!transcript) {
    throw new Error("ElevenLabs returned an empty transcript.");
  }

  return transcript;
}

async function transcribeWithWhisper(audioBuffer, mimeType) {
  const requestId = randomUUID();
  const requestDirectory = path.join(dataRoot, `whisper-${requestId}`);
  ensureDirectorySync(requestDirectory);

  const inputPath = path.join(requestDirectory, `input.${extensionForMimeType(mimeType)}`);
  const outputDirectory = path.join(requestDirectory, "output");
  ensureDirectorySync(outputDirectory);

  await fsp.writeFile(inputPath, audioBuffer);

  const args = [
    "-m",
    "whisper",
    inputPath,
    "--model",
    environmentConfiguration.whisperModel,
    "--output_dir",
    outputDirectory,
    "--output_format",
    "txt",
    "--fp16",
    "False"
  ];

  if (environmentConfiguration.whisperLanguage) {
    args.push("--language", environmentConfiguration.whisperLanguage);
  }

  const result = await runProcess(environmentConfiguration.whisperPythonCommand, args, {
    cwd: requestDirectory,
    timeoutMs: 30 * 60 * 1000
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Whisper failed.\nstdout:\n${result.stdout || "<empty>"}\nstderr:\n${result.stderr || "<empty>"}`
    );
  }

  const transcriptPath = path.join(
    outputDirectory,
    `${path.basename(inputPath, path.extname(inputPath))}.txt`
  );

  if (!fs.existsSync(transcriptPath)) {
    throw new Error("Whisper did not produce a transcript file.");
  }

  const transcript = (await fsp.readFile(transcriptPath, "utf8")).trim();
  if (!transcript) {
    throw new Error("Whisper returned an empty transcript.");
  }

  return transcript;
}

async function transcribeWithSherpaOnnx(audioBuffer, mimeType) {
  const pcmFloat32Buffer = convertAudioBufferToSherpaPayload(audioBuffer, mimeType);
  const sampleRateBuffer = Buffer.alloc(4);
  sampleRateBuffer.writeUInt32LE(environmentConfiguration.sherpaOnnxSampleRate, 0);

  const sampleCountBuffer = Buffer.alloc(4);
  sampleCountBuffer.writeUInt32LE(pcmFloat32Buffer.length, 0);

  const websocketPayload = Buffer.concat([
    sampleRateBuffer,
    sampleCountBuffer,
    pcmFloat32Buffer
  ]);

  return await sendSherpaOnnxRequest(websocketPayload);
}

async function sendSherpaOnnxRequest(payload) {
  const websocketUrl = new URL(
    `ws://${environmentConfiguration.sherpaOnnxServerAddress}:${environmentConfiguration.sherpaOnnxServerPort}`
  );

  return await new Promise((resolve, reject) => {
    const websocket = new WebSocket(websocketUrl);
    let responseText = "";
    let finished = false;

    const timeoutHandle = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        websocket.close();
      } catch (_error) {
      }
      reject(new Error("Sherpa-ONNX STT request timed out."));
    }, environmentConfiguration.sherpaOnnxTimeoutSeconds * 1000);

    websocket.addEventListener("open", async () => {
      try {
        const chunkSize = environmentConfiguration.sherpaOnnxChunkBytes;
        for (let offset = 0; offset < payload.length; offset += chunkSize) {
          websocket.send(payload.subarray(offset, offset + chunkSize));
        }
      } catch (error) {
        clearTimeout(timeoutHandle);
        finished = true;
        reject(error);
      }
    });

    websocket.addEventListener("message", (event) => {
      responseText = typeof event.data === "string"
        ? event.data
        : Buffer.from(event.data).toString("utf8");
      websocket.send("Done");
    });

    websocket.addEventListener("close", () => {
      if (finished) {
        return;
      }
      clearTimeout(timeoutHandle);
      finished = true;
      const transcript = String(responseText || "").trim();
      if (!transcript) {
        reject(new Error("Sherpa-ONNX returned an empty transcript."));
        return;
      }
      resolve(transcript);
    });

    websocket.addEventListener("error", () => {
      if (finished) {
        return;
      }
      clearTimeout(timeoutHandle);
      finished = true;
      reject(new Error("Sherpa-ONNX websocket connection failed."));
    });
  });
}

function convertAudioBufferToSherpaPayload(audioBuffer, mimeType) {
  const extension = extensionForMimeType(mimeType);
  if (extension !== "wav") {
    throw new Error("Sherpa-ONNX STT currently expects WAV audio input.");
  }

  const wavPayload = parseWavPcm16(audioBuffer);
  if (wavPayload.sampleRate !== environmentConfiguration.sherpaOnnxSampleRate) {
    throw new Error(
      `Sherpa-ONNX expects ${environmentConfiguration.sherpaOnnxSampleRate} Hz WAV input, got ${wavPayload.sampleRate} Hz.`
    );
  }
  if (wavPayload.channelCount !== 1) {
    throw new Error(`Sherpa-ONNX expects mono WAV input, got ${wavPayload.channelCount} channels.`);
  }

  const pcm16Buffer = wavPayload.pcmData;
  const float32Buffer = Buffer.alloc(pcm16Buffer.length * 2);
  for (let offset = 0; offset < pcm16Buffer.length; offset += 2) {
    const sample = pcm16Buffer.readInt16LE(offset) / 32768;
    float32Buffer.writeFloatLE(sample, (offset / 2) * 4);
  }

  return float32Buffer;
}

function parseWavPcm16(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV file for Sherpa-ONNX STT.");
  }

  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  let bitsPerSample = 0;
  let pcmData = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;

    if (chunkDataEnd > buffer.length) {
      break;
    }

    if (chunkId === "fmt ") {
      const audioFormat = buffer.readUInt16LE(chunkDataStart);
      channelCount = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
      if (audioFormat !== 1) {
        throw new Error("Sherpa-ONNX STT expects PCM WAV input.");
      }
    } else if (chunkId === "data") {
      pcmData = buffer.subarray(chunkDataStart, chunkDataEnd);
    }

    offset = chunkDataEnd + (chunkSize % 2);
  }

  if (!pcmData || !sampleRate || !channelCount || bitsPerSample !== 16) {
    throw new Error("Sherpa-ONNX STT requires 16-bit PCM mono WAV input.");
  }

  return {
    sampleRate,
    channelCount,
    pcmData
  };
}

async function runCodex(environmentConfigurationValue, prompt, imagePaths) {
  const assistantSlug = getAssistantSlug();
  const outputFilePath = path.join(
    codexOutputRoot,
    `${assistantSlug}-codex-${timestamp()}.txt`
  );
  const workingDirectory = resolveCodexWorkingDirectory(environmentConfigurationValue);
  ensureDirectorySync(workingDirectory);

  const command = splitCommand(environmentConfigurationValue.codexCommand);
  if (!command.length) {
    throw new Error("CODEX_COMMAND is missing.");
  }

  const args = [
    ...command.slice(1),
    "exec",
    "--full-auto",
    "--skip-git-repo-check",
    "-C",
    workingDirectory,
    "-o",
    outputFilePath
  ];

  for (const imagePath of imagePaths || []) {
    args.push("-i", imagePath);
  }

  args.push("-");

  const result = await runProcess(command[0], args, {
    cwd: workingDirectory,
    stdin: prompt,
    timeoutMs: environmentConfigurationValue.codexTimeoutSeconds * 1000
  });

  await writeRunLog(outputFilePath, {
    title: `${getAssistantIdentity().name} codex run`,
    metadata: {
      timestamp: new Date().toISOString(),
      working_directory: workingDirectory,
      exit_code: String(result.exitCode)
    },
    prompt,
    stdout: result.stdout,
    stderr: result.stderr
  });

  if (result.exitCode !== 0) {
    throw new Error(`Codex failed. Check the output file: ${outputFilePath}`);
  }

  return { outputFilePath };
}

async function runClaudeCode(environmentConfigurationValue, prompt) {
  const assistantSlug = getAssistantSlug();
  const outputFilePath = path.join(
    codexOutputRoot,
    `${assistantSlug}-claude-code-${timestamp()}.txt`
  );
  const workingDirectory = resolveCodexWorkingDirectory(environmentConfigurationValue);
  ensureDirectorySync(workingDirectory);

  const command = splitCommand(environmentConfigurationValue.claudeCodeCommand);
  if (!command.length) {
    throw new Error("CLAUDE_CODE_COMMAND is missing.");
  }

  const args = [
    ...command.slice(1),
    "-p",
    "--permission-mode",
    "bypassPermissions"
  ];

  const result = await runProcess(command[0], args, {
    cwd: workingDirectory,
    stdin: prompt,
    timeoutMs: environmentConfigurationValue.codexTimeoutSeconds * 1000
  });

  await writeRunLog(outputFilePath, {
    title: `${getAssistantIdentity().name} claude code run`,
    metadata: {
      timestamp: new Date().toISOString(),
      working_directory: workingDirectory,
      exit_code: String(result.exitCode)
    },
    prompt,
    stdout: result.stdout,
    stderr: result.stderr
  });

  if (result.exitCode !== 0) {
    throw new Error(`Claude Code failed. Check the output file: ${outputFilePath}`);
  }

  return { outputFilePath };
}

async function runOpenClaw(environmentConfigurationValue, prompt) {
  const assistantSlug = getAssistantSlug();
  const outputFilePath = path.join(
    codexOutputRoot,
    `${assistantSlug}-openclaw-${timestamp()}.txt`
  );

  const command = splitCommand(environmentConfigurationValue.openClawCommand);
  if (!command.length) {
    throw new Error("OPENCLAW_COMMAND is missing.");
  }

  const args = [
    ...command.slice(1),
    "agent",
    "--agent",
    resolveOpenClawAgentId(environmentConfigurationValue.openClawSessionKey),
    "--message",
    prompt,
    "--timeout",
    String(environmentConfigurationValue.openClawTimeoutSeconds)
  ];

  const childEnvironment = {
    ...process.env,
    OPENCLAW_GATEWAY_URL: environmentConfigurationValue.openClawGatewayUrl,
    GATEWAY_TOKEN: environmentConfigurationValue.openClawGatewayToken
  };

  const result = await runProcess(command[0], args, {
    cwd: repoRoot,
    env: childEnvironment,
    timeoutMs: environmentConfigurationValue.openClawTimeoutSeconds * 1000 + 15000
  });

  await writeRunLog(outputFilePath, {
    title: `${getAssistantIdentity().name} openclaw run`,
    metadata: {
      timestamp: new Date().toISOString(),
      command: environmentConfigurationValue.openClawCommand,
      agent: resolveOpenClawAgentId(environmentConfigurationValue.openClawSessionKey),
      exit_code: String(result.exitCode)
    },
    prompt,
    stdout: result.stdout,
    stderr: result.stderr
  });

  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || "").trim() || `OpenClaw failed. Check the output file: ${outputFilePath}`);
  }

  return {
    outputFilePath,
    responseText: (result.stdout || "").trim()
  };
}

async function saveBrowserScreenshot(screenshotDataUrl, prefix) {
  ensureDirectorySync(screenCaptureRoot);
  const parsed = parseImageDataUrl(screenshotDataUrl);
  const extension = parsed.mediaType === "image/png" ? "png" : "jpg";
  const filePath = path.join(
    screenCaptureRoot,
    `${getAssistantSlug()}-${prefix}-screen-${timestamp()}.${extension}`
  );
  await fsp.writeFile(filePath, Buffer.from(parsed.base64, "base64"));
  return filePath;
}

async function saveVisionDebugArtifacts({
  screenshotDataUrl,
  roiSelections = [],
  prompt,
  requestedMode
}) {
  const directoryPath = path.join(visionDebugRoot, "latest");
  await fsp.rm(directoryPath, { recursive: true, force: true });
  ensureDirectorySync(directoryPath);

  const fullImagePath = await saveImageDataUrlToPath(
    screenshotDataUrl,
    path.join(directoryPath, "full")
  );

  const roiPaths = [];
  for (let index = 0; index < roiSelections.length; index += 1) {
    const roi = roiSelections[index];
    const roiPath = await saveImageDataUrlToPath(
      roi.imageDataUrl,
      path.join(directoryPath, `roi-${index + 1}`)
    );
    roiPaths.push({
      path: roiPath,
      x: roi.x,
      y: roi.y,
      width: roi.width,
      height: roi.height,
      label: roi.label
    });
  }

  await fsp.writeFile(
    path.join(directoryPath, "meta.json"),
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        prompt,
        requestedMode,
        roiCount: roiSelections.length,
        fullImagePath,
        roiPaths
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    directoryPath,
    fullImagePath,
    roiPaths: roiPaths.map((entry) => entry.path)
  };
}

async function saveImageDataUrlToPath(dataUrl, outputPathWithoutExtension) {
  const parsed = parseImageDataUrl(dataUrl);
  const extension = parsed.mediaType === "image/png" ? "png" : "jpg";
  const outputPath = `${outputPathWithoutExtension}.${extension}`;
  await fsp.writeFile(outputPath, Buffer.from(parsed.base64, "base64"));
  return outputPath;
}

function buildCompanionPrompt() {
  return `${loadSoulPrompt().trim()}\n\n${buildCompanionBehaviorRules()}`;
}

function buildCompanionBehaviorRules() {
  const identity = getAssistantIdentity();
  return renderPrompt("companionBehaviorRules", {
    assistantName: identity.name,
    assistantRole: identity.role
  });
}

function getAssistantIdentity() {
  const soulPrompt = loadSoulPrompt();
  const identity = parseSoulIdentity(soulPrompt);
  return {
    name: identity.name || "Domovik",
    role: identity.role || "local desktop assistant",
    wakePhrase: identity.wake_phrase || "Hey Domovik",
    signatureReply: identity.signature_reply || "Hey there, at your service."
  };
}

function getAssistantSlug() {
  return getAssistantIdentity()
    .name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "domovik";
}

function parseSoulIdentity(soulText) {
  const match = soulText.match(/## Self-Identity\s+([\s\S]*?)(?:\n## |\n# |$)/i);
  if (!match) {
    return {};
  }

  const identity = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^-\s*([a-z_]+)\s*:\s*(.+)$/i);
    if (!bulletMatch) {
      continue;
    }
    identity[bulletMatch[1].toLowerCase()] = bulletMatch[2].trim();
  }
  return identity;
}

function loadSoulPrompt() {
  try {
    const soulText = fs.readFileSync(soulFilePath, "utf8").trim();
    return soulText || getPromptTemplate("defaultSoulPrompt");
  } catch (_error) {
    return getPromptTemplate("defaultSoulPrompt");
  }
}

function loadPromptTemplates() {
  try {
    return JSON.parse(fs.readFileSync(promptsFilePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to load linux/prompts.json: ${error.message}`);
  }
}

function getPromptTemplate(name) {
  const template = promptTemplates?.[name];
  if (typeof template !== "string" || !template.trim()) {
    throw new Error(`Prompt template "${name}" is missing in linux/prompts.json.`);
  }
  return template;
}

function renderPrompt(name, variables = {}) {
  const template = getPromptTemplate(name);
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    if (!(key in variables)) {
      return "";
    }
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}

function normalizeForIntentMatching(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAnyIntent(normalizedPrompt, phrases) {
  return phrases.some((phrase) => normalizedPrompt.includes(normalizeForIntentMatching(phrase)));
}

function shouldRequireRoiForExactReading(prompt, roiSelections) {
  if (roiSelections.length > 0) {
    return false;
  }

  const normalizedPrompt = normalizeForIntentMatching(prompt);
  const asksExactRead = matchesAnyIntent(normalizedPrompt, [
    "read the exact",
    "read the number",
    "read the value",
    "read the text",
    "exact value",
    "exact text",
    "read exact",
    "quote the exact",
    "what number",
    "which number",
    "what value",
    "which value",
    "what text",
    "which text",
    "what does it say",
    "what is written",
    "what exactly is written",
    "what is the exact",
    "назови точное",
    "назови число",
    "какое число",
    "какое значение",
    "что там написано",
    "что написано",
    "прочитай точно",
    "точное значение",
    "точный текст",
    "что точно написано",
    "точно что написано",
    "welche zahl",
    "welcher wert",
    "welcher text",
    "was steht dort",
    "lies den genauen",
    "genauer wert",
    "genauer text",
    "was steht genau",
    "genau ablesen"
  ]);

  if (asksExactRead) {
    return true;
  }

  const asksForReadingTarget =
    matchesAnyIntent(normalizedPrompt, [
      "number",
      "value",
      "text",
      "written",
      "label",
      "число",
      "значение",
      "текст",
      "написано",
      "надпись",
      "zahl",
      "wert",
      "text",
      "beschriftung"
    ]) &&
    matchesAnyIntent(normalizedPrompt, [
      "on the screen",
      "in the image",
      "in the screenshot",
      "on the right",
      "on the left",
      "справа",
      "слева",
      "на экране",
      "на скрине",
      "на изображении",
      "im bild",
      "im screenshot",
      "rechts",
      "links"
    ]);

  return asksForReadingTarget;
}

function shouldGuardMissingCurrentVisualContext(prompt) {
  const normalizedPrompt = normalizeForIntentMatching(prompt);
  if (!normalizedPrompt) {
    return false;
  }

  const refersToPreviousVisual = matchesAnyIntent(normalizedPrompt, [
    "previous image",
    "previous picture",
    "previous screenshot",
    "previous screen",
    "last image",
    "last picture",
    "last screenshot",
    "earlier image",
    "earlier screenshot",
    "image before",
    "picture before",
    "предыдущая картинка",
    "предыдущей картинке",
    "предыдущее изображение",
    "предыдущий скрин",
    "предыдущем скрине",
    "прошлая картинка",
    "прошлом скриншоте",
    "что было на предыдущей",
    "was on the previous",
    "was on the last screenshot",
    "vorherige bild",
    "vorherigen bild",
    "letzten screenshot",
    "vorherigen screenshot",
    "vorher auf dem bild"
  ]);
  if (refersToPreviousVisual) {
    return false;
  }

  return matchesAnyIntent(normalizedPrompt, [
    "what do you see on the image",
    "what do you see in the image",
    "what do you see on the picture",
    "what do you see in the picture",
    "what do you see on the screenshot",
    "what do you see in the screenshot",
    "what is on the image",
    "what is on the picture",
    "what is on the screenshot",
    "what's on the image",
    "what's on the picture",
    "what's on the screenshot",
    "describe the image",
    "describe the picture",
    "describe the screenshot",
    "опиши картинку",
    "что на картинке",
    "что на изображении",
    "что на скриншоте",
    "что ты видишь на картинке",
    "что ты видишь на изображении",
    "что ты видишь на скриншоте",
    "was siehst du auf dem bild",
    "was siehst du im bild",
    "was ist auf dem bild",
    "beschreibe das bild",
    "beschreibe den screenshot"
  ]);
}

async function serveStaticFile(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const absolutePath = path.normalize(path.join(publicRoot, safePath));

  if (!absolutePath.startsWith(publicRoot)) {
    createHttpError(403, "Forbidden");
  }

  let filePath = absolutePath;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    createHttpError(404, "Not found");
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  })[extension] || "application/octet-stream";

  response.writeHead(200, { "content-type": contentType });
  fs.createReadStream(filePath).pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let receivedBytes = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxRequestBytes) {
        reject(createError(413, "The request is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (_error) {
        reject(createError(400, "Invalid JSON in request."));
      }
    });

    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function createHttpError(statusCode, message) {
  throw createError(statusCode, message);
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function loadEnvironmentConfiguration() {
  const envValues = {};
  if (fs.existsSync(envFilePath)) {
    const lines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const trimmedLine = rawLine.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      let value = trimmedLine.slice(separatorIndex + 1).trim();
      if (value.startsWith("\"") && value.endsWith("\"")) {
        value = value.slice(1, -1);
      }
      envValues[key] = value;
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.length > 0) {
      envValues[key] = value;
    }
  }

  return {
    port: parseInteger(envValues.PORT, 3000),
    textProvider: (envValues.TEXT_PROVIDER || "vision_provider").trim().toLowerCase() === "minimax"
      ? "minimax"
      : "vision_provider",
    visionProvider: (envValues.VISION_PROVIDER || "anthropic").trim().toLowerCase() === "openai_compat"
      ? "openai_compat"
      : "anthropic",
    anthropicApiKey: envValues.ANTHROPIC_API_KEY || "",
    anthropicModel: envValues.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    visionBaseUrl: envValues.VISION_BASE_URL || envValues.OPENAI_COMPAT_BASE_URL || "",
    visionApiKey: envValues.VISION_API_KEY || envValues.OPENAI_COMPAT_API_KEY || "",
    visionModel: envValues.VISION_MODEL || envValues.OPENAI_COMPAT_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct",
    visionMaxImages: parseInteger(envValues.VISION_MAX_IMAGES || envValues.OPENAI_COMPAT_MAX_IMAGES, 1),
    tavilyApiKey: envValues.TAVILY_API_KEY || "",
    agenticMaxCycles: Math.max(
      1,
      parseInteger(envValues.AGENTIC_MAX_CYCLES, defaultAgenticMaxCycles)
    ),
    agenticRuntimeSeconds: Math.max(
      1,
      parseInteger(envValues.AGENTIC_RUNTIME_SECONDS, defaultAgenticRuntimeSeconds)
    ),
    searchHttpTimeoutSeconds: Math.max(
      1,
      parseInteger(envValues.SEARCH_HTTP_TIMEOUT_SECONDS, defaultSearchHttpTimeoutSeconds)
    ),
    visualAugmentationProviders: envValues.VISUAL_AUGMENTATION_PROVIDERS || "",
    visionCfAccessClientId:
      envValues.VISION_CF_ACCESS_CLIENT_ID || envValues.OPENAI_COMPAT_CF_ACCESS_CLIENT_ID || "",
    visionCfAccessClientSecret:
      envValues.VISION_CF_ACCESS_CLIENT_SECRET || envValues.OPENAI_COMPAT_CF_ACCESS_CLIENT_SECRET || "",
    miniMaxTextBaseUrl: envValues.MINIMAX_TEXT_BASE_URL || defaultMiniMaxTextBaseUrl,
    miniMaxTextModel: envValues.MINIMAX_TEXT_MODEL || "MiniMax-M2.7",
    textToSpeechProvider: (envValues.TTS_PROVIDER || "elevenlabs").trim().toLowerCase() === "minimax"
      ? "minimax"
      : "elevenlabs",
    elevenLabsApiKey: envValues.ELEVENLABS_API_KEY || "",
    elevenLabsVoiceId: envValues.ELEVENLABS_VOICE_ID || "",
    elevenLabsSttModel: envValues.ELEVENLABS_STT_MODEL || "scribe_v2",
    elevenLabsTtsModel: envValues.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
    miniMaxApiKey: envValues.MINIMAX_API_KEY || "",
    miniMaxTextToSpeechUrl: envValues.MINIMAX_TTS_URL || defaultMiniMaxTextToSpeechUrl,
    miniMaxTtsModel: envValues.MINIMAX_TTS_MODEL || "speech-2.8-turbo",
    miniMaxVoiceId: envValues.MINIMAX_VOICE_ID || "",
    miniMaxVoiceSpeed: parseFloatValue(envValues.MINIMAX_VOICE_SPEED, 1),
    miniMaxVoiceVolume: parseFloatValue(envValues.MINIMAX_VOICE_VOLUME, 1),
    miniMaxVoicePitch: parseFloatValue(envValues.MINIMAX_VOICE_PITCH, 0),
    miniMaxAudioSampleRate: parseInteger(envValues.MINIMAX_AUDIO_SAMPLE_RATE, 32000),
    miniMaxAudioBitrate: parseInteger(envValues.MINIMAX_AUDIO_BITRATE, 128000),
    elevenLabsSpeechKeyterms: parseKeyterms(
      envValues.ELEVENLABS_STT_KEYTERMS,
      defaultSpeechKeyterms
    ),
    speechToTextProvider: parseSpeechToTextProvider(envValues.STT_PROVIDER || "elevenlabs"),
    sherpaOnnxServerAddress: envValues.SHERPA_ONNX_SERVER_ADDR || "127.0.0.1",
    sherpaOnnxServerPort: parseInteger(envValues.SHERPA_ONNX_SERVER_PORT, 6006),
    sherpaOnnxSampleRate: parseInteger(envValues.SHERPA_ONNX_SAMPLE_RATE, 16000),
    sherpaOnnxChunkBytes: parseInteger(envValues.SHERPA_ONNX_CHUNK_BYTES, 10240),
    sherpaOnnxTimeoutSeconds: parseInteger(envValues.SHERPA_ONNX_TIMEOUT_SECONDS, 30),
    codexCommand: envValues.CODEX_COMMAND || "codex",
    claudeCodeCommand: envValues.CLAUDE_CODE_COMMAND || "claude",
    codexWorkingDirectory: envValues.CODEX_WORKDIR || "../playground",
    codexTimeoutSeconds: parseInteger(envValues.CODEX_TIMEOUT_SECONDS, 900),
    openClawCommand: envValues.OPENCLAW_COMMAND || "openclaw",
    openClawSessionKey: envValues.OPENCLAW_SESSION_KEY || "main",
    openClawTimeoutSeconds: parseInteger(envValues.OPENCLAW_TIMEOUT_SECONDS, 900),
    openClawGatewayUrl: envValues.OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789",
    openClawGatewayToken: envValues.GATEWAY_TOKEN || "",
    whisperPythonCommand: envValues.WHISPER_PYTHON || "python3",
    whisperModel: envValues.WHISPER_MODEL || "base",
    whisperLanguage: envValues.WHISPER_LANGUAGE || "de"
  };
}

function parseKeyterms(value, fallbackValues) {
  const sourceValues = typeof value === "string" && value.trim() ? value.split(",") : fallbackValues;
  return sourceValues
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .slice(0, 100);
}

function parseInteger(value, fallbackValue) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

function parseFloatValue(value, fallbackValue) {
  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
}

function parseSpeechToTextProvider(value) {
  const normalizedValue = String(value || "elevenlabs").trim().toLowerCase();
  if (normalizedValue === "whisper") {
    return "whisper";
  }
  if (normalizedValue === "sherpa_onnx") {
    return "sherpa_onnx";
  }
  return "elevenlabs";
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeOpenAiCompatibleContent(contentValue) {
  if (typeof contentValue === "string") {
    return contentValue.trim();
  }

  if (Array.isArray(contentValue)) {
    return contentValue
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (entry && typeof entry.text === "string") {
          return entry.text.trim();
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function parseImageDataUrl(value) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value);
  if (!match) {
    throw new Error("Invalid screenshot format.");
  }
  return {
    mediaType: match[1],
    base64: match[2]
  };
}

function decodeDataUrlOrBase64(value) {
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/.exec(value);
  const base64 = dataUrlMatch ? dataUrlMatch[2] : value;
  return Buffer.from(base64, "base64");
}

function extensionForMimeType(mimeType) {
  switch ((mimeType || "").toLowerCase()) {
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
      return "wav";
    case "audio/mp4":
      return "mp4";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

function stripPointTag(text) {
  return (text || "").replace(/\s*\[POINT:[^\]]+\]\s*$/u, "").trim();
}

function resolveCodexWorkingDirectory(environmentConfigurationValue) {
  if (path.isAbsolute(environmentConfigurationValue.codexWorkingDirectory)) {
    return environmentConfigurationValue.codexWorkingDirectory;
  }
  return path.resolve(__dirname, environmentConfigurationValue.codexWorkingDirectory);
}

function resolveOpenClawAgentId(sessionKey) {
  const normalized = (sessionKey || "main").trim();
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length >= 2 && parts[0].toLowerCase() === "agent") {
    return parts[1];
  }
  return normalized || "main";
}

function splitCommand(commandText) {
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match;
  while ((match = pattern.exec(commandText || "")) !== null) {
    parts.push(match[1] || match[2] || match[0]);
  }
  return parts;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function ensureDirectorySync(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

async function writeRunLog(outputFilePath, payload) {
  const lines = [payload.title];
  for (const [key, value] of Object.entries(payload.metadata || {})) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("");
  lines.push("prompt:");
  lines.push(payload.prompt || "");
  lines.push("");
  lines.push("stdout:");
  lines.push((payload.stdout || "").trim() || "<empty>");
  lines.push("");
  lines.push("stderr:");
  lines.push((payload.stderr || "").trim() || "<empty>");
  lines.push("");
  await fsp.writeFile(outputFilePath, lines.join("\n"), "utf8");
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeoutHandle = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (!finished) {
        finished = true;
        reject(error);
      }
    });

    child.on("close", (exitCode, signal) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (finished) {
        return;
      }
      finished = true;
      resolve({
        exitCode: typeof exitCode === "number" ? exitCode : 1,
        signal,
        stdout,
        stderr
      });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

function normalizePrompt(prompt) {
  let normalized = ` ${(prompt || "").toLowerCase()} `;

  normalized = replaceMany(normalized, [
    ["nehm", "nimm"],
    ["нем", "ним"],
    ["кодекс", "codex"],
    ["кодэкс", "codex"],
    ["кодекc", "codex"],
    ["кодексс", "codex"],
    ["кодек", "codex"],
    ["кодикс", "codex"],
    ["кодиксс", "codex"],
    ["kodex", "codex"],
    ["kodes", "codex"],
    ["codecs", "codex"],
    ["codexx", "codex"],
    ["клауд код", "claude code"],
    ["клоуд код", "claude code"],
    ["клаудкоуд", "claude code"],
    ["клауд коуд", "claude code"],
    ["клот код", "claude code"],
    ["клод код", "claude code"],
    ["клад код", "claude code"],
    ["cloud code", "claude code"],
    ["clod code", "claude code"],
    ["klod code", "claude code"],
    ["klode code", "claude code"],
    ["клаус", "openclaw"],
    ["клаусс", "openclaw"],
    ["клаусу", "openclaw"],
    ["опен клоу", "openclaw"],
    ["опен кло", "openclaw"],
    ["оупен клоу", "openclaw"],
    ["оупен кло", "openclaw"],
    ["опенклоу", "openclaw"],
    ["опенкло", "openclaw"],
    ["open claw", "openclaw"],
    ["open clau", "openclaw"],
    ["openclau", "openclaw"],
    ["openclo", "openclaw"],
    ["obenclaw", "openclaw"],
    ["obenclau", "openclaw"],
    ["orpenclaw", "openclaw"],
    ["orpenclau", "openclaw"],
    ["onpenclaw", "openclaw"],
    ["onpenclau", "openclaw"],
    ["oppenclaw", "openclaw"],
    ["oppenclau", "openclaw"],
    ["screen shot", "screenshot"],
    ["screen-shot", "screenshot"],
    ["haupt bildschirm", "hauptbildschirm"],
    ["скрин шот", "скриншот"],
    ["сcreen", "screen"]
  ]);

  normalized = normalized
    .replace(/[«»“”"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

function isCodexTriggered(prompt) {
  return getCodexTriggerRegex().test(normalizePrompt(prompt));
}

function shouldAttachScreens(prompt) {
  return getCodexWithScreenTriggerRegex().test(normalizePrompt(prompt));
}

function removeCodexTrigger(prompt) {
  const normalizedPrompt = normalizePrompt(prompt);
  return normalizedPrompt
    .replace(getCodexWithScreenRemovalRegex(), "")
    .replace(getCodexRemovalRegex(), "")
    .trim();
}

function isClaudeCodeTriggered(prompt) {
  return getClaudeCodeTriggerRegex().test(normalizePrompt(prompt));
}

function removeClaudeCodeTrigger(prompt) {
  return normalizePrompt(prompt)
    .replace(getClaudeCodeRemovalRegex(), "")
    .trim();
}

function isOpenClawTriggered(prompt) {
  return getOpenClawTriggerRegex().test(normalizePrompt(prompt));
}

function removeOpenClawTrigger(prompt) {
  return normalizePrompt(prompt)
    .replace(getOpenClawRemovalRegex(), "")
    .trim();
}

function replaceMany(input, replacements) {
  let output = input;
  for (const [fromValue, toValue] of replacements) {
    output = output.replaceAll(fromValue, toValue);
  }
  return output;
}

function getCommandPrefixPattern() {
  return String.raw`(?:nimm|nim|mit|use|run|start|launch|open|ask|tell|send|give|take|используй|запусти|отправь|передай|возьми|дай|попроси)`;
}

function getCommandJoinPattern() {
  return String.raw`(?:den|the|to|for|через|в|на)?\s*`;
}

function getScreenAttachmentPattern() {
  return String.raw`(?:mit|plus|with|using|and|со|с)\s+(?:screen capture|screenshot|screen|hauptbildschirm|hauptscreen|bild|скриншот(?:ом)?|скрин|экран(?:ом)?)`;
}

function getCodexTriggerRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}codex(?=[\s,:-]|$)`,
    "u"
  );
}

function getCodexWithScreenTriggerRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}codex\s+${getScreenAttachmentPattern()}(?=[\s,:-]|$)`,
    "u"
  );
}

function getCodexRemovalRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}codex(?=[\s,:-]|$)[\s,:-]*`,
    "u"
  );
}

function getCodexWithScreenRemovalRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}codex\s+${getScreenAttachmentPattern()}(?=[\s,:-]|$)[\s,:-]*`,
    "u"
  );
}

function getClaudeCodeTriggerRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}claude code(?=[\s,:-]|$)`,
    "u"
  );
}

function getClaudeCodeRemovalRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}claude code(?=[\s,:-]|$)[\s,:-]*`,
    "u"
  );
}

function getOpenClawTriggerRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}openclaw(?=[\s,:-]|$)`,
    "u"
  );
}

function getOpenClawRemovalRegex() {
  return new RegExp(
    String.raw`^${getCommandPrefixPattern()}\s+${getCommandJoinPattern()}openclaw(?=[\s,:-]|$)[\s,:-]*`,
    "u"
  );
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createServer,
  startServer,
  normalizePrompt,
  isCodexTriggered,
  shouldAttachScreens,
  removeCodexTrigger,
  isClaudeCodeTriggered,
  removeClaudeCodeTrigger,
  isOpenClawTriggered,
  removeOpenClawTrigger,
  parseKeyterms,
  shouldGuardMissingCurrentVisualContext
};
