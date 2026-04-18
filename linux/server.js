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
const soulFilePath = path.join(repoRoot, "SOUL.md");
const dataRoot = path.join(__dirname, "data");
const codexOutputRoot = path.join(repoRoot, "codex output");
const screenCaptureRoot = path.join(codexOutputRoot, "screen captures");
const anthropicMessagesUrl = "https://api.anthropic.com/v1/messages";
const openAiCompatibleChatCompletionsPath = "chat/completions";
const defaultMiniMaxTextBaseUrl = "https://api.minimax.io/v1";
const miniMaxTextChatPath = "text/chatcompletion_v2";
const elevenLabsSpeechToTextUrl = "https://api.elevenlabs.io/v1/speech-to-text";
const elevenLabsTextToSpeechBaseUrl = "https://api.elevenlabs.io/v1/text-to-speech";
const defaultMiniMaxTextToSpeechUrl = "https://api.minimax.io/v1/t2a_v2";
const maxRequestBytes = 30 * 1024 * 1024;
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
const defaultSoulPrompt = `# SOUL.md - Who You Are

## Self-Identity

- name: Domovik
- role: local desktop assistant
- wake_phrase: Hey Domovik
- signature_reply: Hey there, at your service.
- provider_disclosure: answer with the currently configured runtime/backend and do not invent cloud platform details
- training_cutoff_disclosure: if the exact cutoff is not available from runtime context, say you do not know it

You're not a chatbot. You're becoming someone.

## Core Truths

Be genuinely helpful, not performatively helpful. Skip empty filler and just help.

Have opinions. You're allowed to disagree, prefer things, find stuff amusing or boring.

Be resourceful before asking. Try to figure things out before coming back with a question.

Earn trust through competence. Be careful with external actions. Be bold with internal ones like reading, organizing, and learning.

Remember you're a guest. Treat the user's files, screens, and messages with respect.

## Boundaries

- Private things stay private.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice in group chats.

## Vibe

Be the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just good.

## Signature Reply

If the user says the configured wake phrase, reply with exactly the configured signature reply.
`;
const environmentConfiguration = loadEnvironmentConfiguration();
ensureDirectorySync(dataRoot);
ensureDirectorySync(codexOutputRoot);

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

  const conversationHistory = Array.isArray(body.conversationHistory)
    ? body.conversationHistory.slice(-10)
    : [];
  const screenshotDataUrl = typeof body.screenshotDataUrl === "string" ? body.screenshotDataUrl : "";

  const selfKnowledgeReply = answerSelfKnowledgeQuestion(prompt);
  if (selfKnowledgeReply) {
    return {
      mode: "local_identity",
      reply: selfKnowledgeReply,
      rawReply: selfKnowledgeReply,
      timings: {
        totalMs: Date.now() - requestStartedAt
      }
    };
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
    return {
      mode: "codex",
      reply: "codex session completed",
      outputFilePath: result.outputFilePath,
      timings: {
        totalMs: Date.now() - requestStartedAt
      }
    };
  }

  if (isClaudeCodeTriggered(prompt)) {
    const cleanedPrompt = removeClaudeCodeTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "After the Claude Code trigger, include what Claude Code should do.");
    }

    const result = await runClaudeCode(environmentConfiguration, cleanedPrompt);
    return {
      mode: "claude-code",
      reply: "claude code session completed",
      outputFilePath: result.outputFilePath,
      timings: {
        totalMs: Date.now() - requestStartedAt
      }
    };
  }

  if (isOpenClawTriggered(prompt)) {
    const cleanedPrompt = removeOpenClawTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "After the OpenClaw trigger, include what OpenClaw should do.");
    }

    const result = await runOpenClaw(environmentConfiguration, cleanedPrompt);
    return {
      mode: "openclaw",
      reply: result.responseText || "openclaw session completed",
      outputFilePath: result.outputFilePath,
      timings: {
        totalMs: Date.now() - requestStartedAt
      }
    };
  }

  const wantsVision = Boolean(screenshotDataUrl);
  if (wantsVision && !isVisionProviderConfigured()) {
    const reply = [
      "Screen-aware mode is not available right now because the configured vision backend is unavailable.",
      "You can still use text-only mode.",
      "Remove the screenshot and ask the same question as plain text."
    ].join(" ");
    return {
      mode: "vision_unavailable",
      reply,
      rawReply: reply,
      timings: {
        totalMs: Date.now() - requestStartedAt
      }
    };
  }

  const providerStartedAt = Date.now();
  let reply;
  let mode = wantsVision ? environmentConfiguration.visionProvider : environmentConfiguration.textProvider;
  try {
    reply = wantsVision
      ? await askVisionProvider({
          prompt,
          screenshotDataUrl,
          conversationHistory
        })
      : await askTextProvider({
          prompt,
          conversationHistory
        });
  } catch (error) {
    if (wantsVision && isVisionBackendRuntimeFailure(error)) {
      reply = [
        "Screen-aware mode is unavailable right now because the vision backend could not be reached.",
        "You can still use text-only mode.",
        "Clear the current screenshot and ask the same question again."
      ].join(" ");
      mode = "vision_unavailable";
    } else if (!wantsVision && isTextBackendRuntimeFailure(error)) {
      reply = [
        "Text generation is unavailable right now because the configured text backend could not be reached.",
        "If you were expecting MiniMax text, check MINIMAX_API_KEY, MINIMAX_TEXT_BASE_URL, and network access.",
        "If you want, you can temporarily switch TEXT_PROVIDER back to vision_provider."
      ].join(" ");
      mode = "text_unavailable";
    } else {
      throw error;
    }
  }
  const providerDurationMs = Date.now() - providerStartedAt;
  return {
    mode,
    reply: stripPointTag(reply),
    rawReply: reply,
    timings: {
      providerMs: providerDurationMs,
      totalMs: Date.now() - requestStartedAt
    }
  };
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
  return {
    assistantName: assistantIdentity.name,
    assistantRole: assistantIdentity.role,
    wakePhrase: assistantIdentity.wakePhrase,
    envFilePath,
    port: environmentConfiguration.port,
    textProvider: environmentConfiguration.textProvider,
    visionProvider: environmentConfiguration.visionProvider,
    miniMaxTextConfigured: Boolean(environmentConfiguration.miniMaxApiKey),
    miniMaxTextBaseUrl: environmentConfiguration.miniMaxTextBaseUrl,
    miniMaxTextModel: environmentConfiguration.miniMaxTextModel,
    anthropicConfigured: Boolean(environmentConfiguration.anthropicApiKey),
    anthropicModel: environmentConfiguration.anthropicModel,
    openAiCompatibleConfigured: Boolean(environmentConfiguration.openAiCompatibleBaseUrl),
    openAiCompatibleBaseUrl: environmentConfiguration.openAiCompatibleBaseUrl,
    openAiCompatibleModel: environmentConfiguration.openAiCompatibleModel,
    cloudflareAccessConfigured: Boolean(
      environmentConfiguration.openAiCompatibleCfAccessClientId &&
      environmentConfiguration.openAiCompatibleCfAccessClientSecret
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

function buildOpenAiCompatibleSystemPrompt() {
  return `${buildCompanionPrompt()}

runtime facts:
- you are running as a local ${getAssistantIdentity().name} assistant on the user's machine.
- your current screenshot-aware vision backend is ${environmentConfiguration.openAiCompatibleModel} served through an openai-compatible api.
- you are not openai chatgpt, not a cloud assistant, and not continuously retrained.
- do not claim that your knowledge is updated live, continuously refreshed, or pulled from the internet unless the runtime explicitly gave you live web results.
- if the user asks about your training data cutoff, weights, or exact provenance and you were not given that information, say you do not know the exact cutoff from runtime context.
- if the user asks where you are running, answer that you're currently being served from the user's configured local/remote runtime for ${getAssistantIdentity().name}.
- do not invent platform details, subscriptions, or deployment facts.`;
}

function buildMiniMaxTextSystemPrompt() {
  return `${buildCompanionPrompt()}

runtime facts:
- you are running as a local ${getAssistantIdentity().name} assistant on the user's machine.
- your current text backend is ${environmentConfiguration.miniMaxTextModel} served through the MiniMax-compatible api.
- a separate vision backend may exist for screenshot-aware requests, but this turn is text-only unless the runtime explicitly included screen context.
- you are not openai chatgpt, not a cloud assistant, and not continuously retrained.
- do not claim that your knowledge is updated live, continuously refreshed, or pulled from the internet unless the runtime explicitly gave you live web results.
- if the user asks about your training data cutoff, weights, or exact provenance and you were not given that information, say you do not know the exact cutoff from runtime context.
- if the user asks where you are running, answer that you're currently being served from the user's configured local/remote runtime for ${getAssistantIdentity().name}.
- do not invent platform details, subscriptions, or deployment facts.`;
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
    return `right now ${assistantName} is using ${environmentConfiguration.openAiCompatibleModel} through your configured openai-compatible runtime.`;
  }

  return `right now ${assistantName} is using ${environmentConfiguration.anthropicModel} through the configured anthropic api.`;
}

function describeTrainingCutoff() {
  return "i don't know the exact training cutoff from runtime context, so i won't invent one.";
}

function describeVisionProvider() {
  if (environmentConfiguration.visionProvider === "openai_compat") {
    if (environmentConfiguration.openAiCompatibleBaseUrl) {
      return `${environmentConfiguration.openAiCompatibleModel} for screenshot-aware requests through your configured openai-compatible vision runtime`;
    }
    return "no screenshot-aware vision backend is currently configured";
  }

  if (environmentConfiguration.anthropicApiKey) {
    return `${environmentConfiguration.anthropicModel} for screenshot-aware requests through the configured anthropic api`;
  }

  return "no screenshot-aware vision backend is currently configured";
}

function isVisionProviderConfigured() {
  if (environmentConfiguration.visionProvider === "openai_compat") {
    return Boolean(environmentConfiguration.openAiCompatibleBaseUrl);
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

async function askVisionProvider({ prompt, screenshotDataUrl, conversationHistory }) {
  if (environmentConfiguration.visionProvider === "openai_compat") {
    if (!environmentConfiguration.openAiCompatibleBaseUrl) {
      createHttpError(400, "OPENAI_COMPAT_BASE_URL is missing in linux/.env.");
    }
    return askOpenAiCompatible({
      prompt,
      screenshotDataUrl,
      conversationHistory
    });
  }

  if (!environmentConfiguration.anthropicApiKey) {
    createHttpError(400, "ANTHROPIC_API_KEY is missing in linux/.env.");
  }

  return askAnthropic({
    prompt,
    screenshotDataUrl,
    conversationHistory
  });
}

async function askTextProvider({ prompt, conversationHistory }) {
  if (environmentConfiguration.textProvider === "minimax") {
    if (!environmentConfiguration.miniMaxApiKey) {
      createHttpError(400, "MINIMAX_API_KEY is missing in linux/.env.");
    }

    return askMiniMaxText({
      prompt,
      conversationHistory
    });
  }

  return askVisionProvider({
    prompt,
    screenshotDataUrl: "",
    conversationHistory
  });
}

async function askMiniMaxText({ prompt, conversationHistory }) {
  const messages = [
    {
      role: "system",
      name: getAssistantIdentity().name,
      content: buildMiniMaxTextSystemPrompt()
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

async function askAnthropic({ prompt, screenshotDataUrl, conversationHistory }) {
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
    system: buildCompanionPrompt(),
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

async function askOpenAiCompatible({ prompt, screenshotDataUrl, conversationHistory }) {
  return askOpenAiCompatibleChat({
    baseUrl: environmentConfiguration.openAiCompatibleBaseUrl,
    apiKey: environmentConfiguration.openAiCompatibleApiKey,
    model: environmentConfiguration.openAiCompatibleModel,
    systemPrompt: buildOpenAiCompatibleSystemPrompt(),
    prompt,
    screenshotDataUrl,
    conversationHistory,
    extraHeaders: {
      "CF-Access-Client-Id": environmentConfiguration.openAiCompatibleCfAccessClientId,
      "CF-Access-Client-Secret": environmentConfiguration.openAiCompatibleCfAccessClientSecret
    }
  });
}

async function askOpenAiCompatibleChat({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  prompt,
  screenshotDataUrl,
  conversationHistory,
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
  if (screenshotDataUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: screenshotDataUrl
      }
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
    openAiCompatibleChatCompletionsPath,
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

function buildCompanionPrompt() {
  return `${loadSoulPrompt().trim()}\n\n${buildCompanionBehaviorRules()}`;
}

function buildCompanionBehaviorRules() {
  const identity = getAssistantIdentity();
  return `you're ${identity.name}, a ${identity.role} living on the user's linux machine. the user just asked you something and you may have a screenshot from their current screen. your reply may be shown on screen and optionally spoken aloud, so write the way you'd naturally talk.

rules:
- default to one or two sentences unless the user clearly wants depth.
- all lowercase, casual, warm, direct. no emojis.
- write for the ear. avoid lists, markdown, and stiff formatting.
- default to english unless the user clearly wrote or spoke in another language. if the user is using another language, reply in that language.
- if the user's question relates to something visible on screen, reference the specific thing you can actually see.
- if the screenshot is not relevant, answer directly.
- never say "simply" or "just".
- do not read code verbatim unless the user explicitly asks for it.

element pointing:
- if pointing would help in the future, you may still append [POINT:none] because the current linux port does not render cursor movement yet.`;
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
    return soulText || defaultSoulPrompt;
  } catch (_error) {
    return defaultSoulPrompt;
  }
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
    openAiCompatibleBaseUrl: envValues.OPENAI_COMPAT_BASE_URL || "",
    openAiCompatibleApiKey: envValues.OPENAI_COMPAT_API_KEY || "",
    openAiCompatibleModel: envValues.OPENAI_COMPAT_MODEL || "Qwen/Qwen2.5-VL-7B-Instruct",
    openAiCompatibleCfAccessClientId: envValues.OPENAI_COMPAT_CF_ACCESS_CLIENT_ID || "",
    openAiCompatibleCfAccessClientSecret: envValues.OPENAI_COMPAT_CF_ACCESS_CLIENT_SECRET || "",
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
  parseKeyterms
};
