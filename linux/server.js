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
const elevenLabsSpeechToTextUrl = "https://api.elevenlabs.io/v1/speech-to-text";
const elevenLabsTextToSpeechBaseUrl = "https://api.elevenlabs.io/v1/text-to-speech";
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

If the user says "Hey Zippy", reply with exactly: "Hey Meister, stehts zu diensten."
`;
const companionBehaviorRules = `you're zippy, a desktop assistant living on the user's linux machine. the user just asked you something and you may have a screenshot from their current screen. your reply may be shown on screen and optionally spoken aloud, so write the way you'd naturally talk.

rules:
- default to one or two sentences unless the user clearly wants depth.
- all lowercase, casual, warm, direct. no emojis.
- write for the ear. avoid lists, markdown, and stiff formatting.
- default to german unless the user clearly wrote or spoke in english. if the user is using english, reply in english.
- if the user's question relates to something visible on screen, reference the specific thing you can actually see.
- if the screenshot is not relevant, answer directly.
- never say "simply" or "just".
- do not read code verbatim unless the user explicitly asks for it.

element pointing:
- if pointing would help in the future, you may still append [POINT:none] because the current linux port does not render cursor movement yet.`;

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
        error: error && error.message ? error.message : "Unbekannter Serverfehler."
      });
    }
  });
}

function startServer() {
  const server = createServer();
  server.listen(environmentConfiguration.port, "127.0.0.1", () => {
    process.stdout.write(
      `Zippy Linux läuft auf http://127.0.0.1:${environmentConfiguration.port}\n`
    );
  });
  return server;
}

async function handleChatRequest(body) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    createHttpError(400, "Bitte gib einen Prompt ein.");
  }

  const conversationHistory = Array.isArray(body.conversationHistory)
    ? body.conversationHistory.slice(-10)
    : [];
  const screenshotDataUrl = typeof body.screenshotDataUrl === "string" ? body.screenshotDataUrl : "";

  if (isCodexTriggered(prompt)) {
    const cleanedPrompt = removeCodexTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "Sag nach 'nimm codex' bitte auch, was Codex tun soll.");
    }

    const imagePaths = shouldAttachScreens(prompt) && screenshotDataUrl
      ? [await saveBrowserScreenshot(screenshotDataUrl, "codex")]
      : [];
    const result = await runCodex(environmentConfiguration, cleanedPrompt, imagePaths);
    return {
      mode: "codex",
      reply: "codex session ist jetzt abgeschlossen",
      outputFilePath: result.outputFilePath
    };
  }

  if (isClaudeCodeTriggered(prompt)) {
    const cleanedPrompt = removeClaudeCodeTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "Sag nach 'nimm claude code' bitte auch, was Claude Code tun soll.");
    }

    const result = await runClaudeCode(environmentConfiguration, cleanedPrompt);
    return {
      mode: "claude-code",
      reply: "claude code session ist jetzt abgeschlossen",
      outputFilePath: result.outputFilePath
    };
  }

  if (isOpenClawTriggered(prompt)) {
    const cleanedPrompt = removeOpenClawTrigger(prompt);
    if (!cleanedPrompt) {
      createHttpError(400, "Sag nach 'nimm openclaw' bitte auch, was OpenClaw tun soll.");
    }

    const result = await runOpenClaw(environmentConfiguration, cleanedPrompt);
    return {
      mode: "openclaw",
      reply: result.responseText || "openclaw session ist jetzt abgeschlossen",
      outputFilePath: result.outputFilePath
    };
  }

  if (!environmentConfiguration.anthropicApiKey) {
    createHttpError(400, "ANTHROPIC_API_KEY fehlt in linux/.env.");
  }

  const reply = await askAnthropic({
    prompt,
    screenshotDataUrl,
    conversationHistory
  });
  return {
    mode: "anthropic",
    reply: stripPointTag(reply),
    rawReply: reply
  };
}

async function handleTranscriptionRequest(body) {
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";

  if (!audioBase64) {
    createHttpError(400, "Es wurde kein Audio übertragen.");
  }

  const audioBuffer = decodeDataUrlOrBase64(audioBase64);
  if (!audioBuffer.length) {
    createHttpError(400, "Die Audiodaten waren leer.");
  }

  if (environmentConfiguration.speechToTextProvider === "whisper") {
    const transcript = await transcribeWithWhisper(audioBuffer, mimeType);
    return { transcript };
  }

  if (!environmentConfiguration.elevenLabsApiKey) {
    createHttpError(400, "ELEVENLABS_API_KEY fehlt für STT.");
  }

  const transcript = await transcribeWithElevenLabs(audioBuffer, mimeType);
  return { transcript };
}

async function handleTextToSpeechRequest(body) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    createHttpError(400, "Es wurde kein Text für TTS übergeben.");
  }

  if (!environmentConfiguration.elevenLabsApiKey || !environmentConfiguration.elevenLabsVoiceId) {
    createHttpError(400, "ELEVENLABS_API_KEY oder ELEVENLABS_VOICE_ID fehlt.");
  }

  const audioBuffer = await synthesizeSpeech(text);
  return {
    audioBase64: audioBuffer.toString("base64"),
    mimeType: "audio/mpeg"
  };
}

function buildStatusPayload() {
  return {
    envFilePath,
    port: environmentConfiguration.port,
    anthropicConfigured: Boolean(environmentConfiguration.anthropicApiKey),
    anthropicModel: environmentConfiguration.anthropicModel,
    elevenLabsConfigured: Boolean(environmentConfiguration.elevenLabsApiKey),
    elevenLabsVoiceConfigured: Boolean(environmentConfiguration.elevenLabsVoiceId),
    speechToTextProvider: environmentConfiguration.speechToTextProvider,
    codexCommand: environmentConfiguration.codexCommand,
    claudeCodeCommand: environmentConfiguration.claudeCodeCommand,
    openClawCommand: environmentConfiguration.openClawCommand,
    codexWorkingDirectory: resolveCodexWorkingDirectory(environmentConfiguration),
    codexOutputDirectory: codexOutputRoot
  };
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
      text: "user's current linux screenshot"
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

async function synthesizeSpeech(text) {
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

async function runCodex(environmentConfigurationValue, prompt, imagePaths) {
  const outputFilePath = path.join(
    codexOutputRoot,
    `zippy-codex-${timestamp()}.txt`
  );
  const workingDirectory = resolveCodexWorkingDirectory(environmentConfigurationValue);
  ensureDirectorySync(workingDirectory);

  const command = splitCommand(environmentConfigurationValue.codexCommand);
  if (!command.length) {
    throw new Error("CODEX_COMMAND fehlt.");
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
    title: "zippy codex run",
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
  const outputFilePath = path.join(
    codexOutputRoot,
    `zippy-claude-code-${timestamp()}.txt`
  );
  const workingDirectory = resolveCodexWorkingDirectory(environmentConfigurationValue);
  ensureDirectorySync(workingDirectory);

  const command = splitCommand(environmentConfigurationValue.claudeCodeCommand);
  if (!command.length) {
    throw new Error("CLAUDE_CODE_COMMAND fehlt.");
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
    title: "zippy claude code run",
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
  const outputFilePath = path.join(
    codexOutputRoot,
    `zippy-openclaw-${timestamp()}.txt`
  );

  const command = splitCommand(environmentConfigurationValue.openClawCommand);
  if (!command.length) {
    throw new Error("OPENCLAW_COMMAND fehlt.");
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
    title: "zippy openclaw run",
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
    `zippy-${prefix}-screen-${timestamp()}.${extension}`
  );
  await fsp.writeFile(filePath, Buffer.from(parsed.base64, "base64"));
  return filePath;
}

function buildCompanionPrompt() {
  return `${loadSoulPrompt().trim()}\n\n${companionBehaviorRules}`;
}

function loadSoulPrompt() {
  try {
    const soulText = fs.readFileSync(soulFilePath, "utf8").trim();
    return soulText || defaultSoulPrompt;
  } catch (_error) {
    return defaultSoulPrompt;
  }
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
        reject(createError(413, "Die Anfrage ist zu groß."));
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
        reject(createError(400, "Ungültiges JSON im Request."));
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
    anthropicApiKey: envValues.ANTHROPIC_API_KEY || "",
    anthropicModel: envValues.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    elevenLabsApiKey: envValues.ELEVENLABS_API_KEY || "",
    elevenLabsVoiceId: envValues.ELEVENLABS_VOICE_ID || "",
    elevenLabsSttModel: envValues.ELEVENLABS_STT_MODEL || "scribe_v2",
    elevenLabsTtsModel: envValues.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
    elevenLabsSpeechKeyterms: parseKeyterms(
      envValues.ELEVENLABS_STT_KEYTERMS,
      defaultSpeechKeyterms
    ),
    speechToTextProvider: (envValues.STT_PROVIDER || "elevenlabs").trim().toLowerCase() === "whisper"
      ? "whisper"
      : "elevenlabs",
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

function parseImageDataUrl(value) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value);
  if (!match) {
    throw new Error("Ungültiges Screenshot-Format.");
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
