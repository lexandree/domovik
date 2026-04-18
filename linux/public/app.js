const state = {
  screenshotDataUrl: "",
  conversationHistory: [],
  mediaRecorder: null,
  recordedChunks: []
};

const promptElement = document.querySelector("#prompt");
const responseElement = document.querySelector("#response");
const historyElement = document.querySelector("#history");
const activityElement = document.querySelector("#activity");
const capturePreviewElement = document.querySelector("#capture-preview");
const statusGridElement = document.querySelector("#status-grid");
const speakResponseElement = document.querySelector("#speak-response");
const useConversationElement = document.querySelector("#use-conversation");
const imageUploadElement = document.querySelector("#image-upload");
const audioPlayerElement = document.querySelector("#player");
const startRecordingButton = document.querySelector("#start-recording");
const stopRecordingButton = document.querySelector("#stop-recording");
const maxScreenshotEdge = 2000;
const screenshotJpegQuality = 0.82;
const defaultAssistantName = "Domovik";

document.querySelector("#refresh-status").addEventListener("click", loadStatus);
document.querySelector("#capture-screen").addEventListener("click", captureScreen);
document.querySelector("#clear-screen").addEventListener("click", clearScreenshot);
document.querySelector("#ask-button").addEventListener("click", askAssistant);
document.querySelector("#clear-history").addEventListener("click", clearConversationHistory);
document.querySelector("#start-recording").addEventListener("click", startRecording);
document.querySelector("#stop-recording").addEventListener("click", stopRecording);
imageUploadElement.addEventListener("change", handleImageUpload);

loadStatus();
renderHistory();

async function loadStatus() {
  setActivity("loading status");
  try {
    const response = await fetch("/api/status");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not load status.");
    }

    applyAssistantIdentity(payload);

    statusGridElement.innerHTML = "";
    appendStatusCard("Assistant", payload.assistantName || defaultAssistantName);
    appendStatusCard("Env file", payload.envFilePath);
    appendStatusCard("Port", String(payload.port));
    appendStatusCard("Text", `${payload.textProvider || "unknown"}`);
    appendStatusCard("Vision", `${payload.visionProvider || "unknown"}`);
    appendStatusCard(
      "Text backend",
      payload.textProvider === "minimax"
        ? (payload.miniMaxTextConfigured
            ? `ok · ${payload.miniMaxTextModel}`
            : "missing")
        : "shared with vision"
    );
    appendStatusCard(
      "Vision backend",
      payload.visionProvider === "openai_compat"
        ? (payload.openAiCompatibleConfigured
            ? `ok · ${payload.openAiCompatibleModel}`
            : "missing")
        : (payload.anthropicConfigured
            ? `ok · ${payload.anthropicModel}`
            : "missing")
    );
    appendStatusCard("TTS", payload.textToSpeechProvider || "unknown");
    appendStatusCard("ElevenLabs", payload.elevenLabsConfigured ? "ok" : "missing");
    appendStatusCard("Voice ID", payload.elevenLabsVoiceConfigured ? "ok" : "missing");
    appendStatusCard("STT", payload.speechToTextProvider);
    appendStatusCard("Codex", payload.codexCommand);
    appendStatusCard("Claude Code", payload.claudeCodeCommand);
    appendStatusCard("OpenClaw", payload.openClawCommand);
    appendStatusCard("Workdir", payload.codexWorkingDirectory);
    appendStatusCard("Logs", payload.codexOutputDirectory);
    setActivity("ready");
  } catch (error) {
    setActivity(error.message);
  }
}

function applyAssistantIdentity(payload) {
  const assistantName = (payload.assistantName || defaultAssistantName).trim() || defaultAssistantName;
  document.title = `${assistantName} Linux`;

  const eyebrowElement = document.querySelector(".eyebrow");
  if (eyebrowElement) {
    eyebrowElement.textContent = `${assistantName} for ubuntu`;
  }

  const askButton = document.querySelector("#ask-button");
  if (askButton) {
    askButton.textContent = `ask ${assistantName}`;
  }
}

function appendStatusCard(label, value) {
  const card = document.createElement("article");
  card.className = "status-card";
  card.innerHTML = `<span>${label}</span><strong>${escapeHtml(value)}</strong>`;
  statusGridElement.appendChild(card);
}

async function captureScreen() {
  setActivity("waiting for screen share");
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: false
    });

    const videoTrack = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();

    const { width, height } = fitWithinMaxEdge(video.videoWidth, video.videoHeight, maxScreenshotEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    state.screenshotDataUrl = canvas.toDataURL("image/jpeg", screenshotJpegQuality);

    video.pause();
    stream.getTracks().forEach((track) => track.stop());
    renderScreenshotPreview();
    setActivity("screen captured");
  } catch (error) {
    setActivity(`screen failed: ${error.message}`);
  }
}

function clearScreenshot() {
  state.screenshotDataUrl = "";
  imageUploadElement.value = "";
  renderScreenshotPreview();
  setActivity("screen cleared");
}

function handleImageUpload(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      state.screenshotDataUrl = await downscaleImageDataUrl(String(reader.result || ""));
      renderScreenshotPreview();
      setActivity("image loaded");
    } catch (error) {
      setActivity(`image failed: ${error.message}`);
    }
  };
  reader.readAsDataURL(file);
}

function renderScreenshotPreview() {
  if (!state.screenshotDataUrl) {
    capturePreviewElement.className = "capture-preview empty";
    capturePreviewElement.textContent = "no screenshot selected";
    return;
  }

  capturePreviewElement.className = "capture-preview";
  capturePreviewElement.innerHTML = `<img src="${state.screenshotDataUrl}" alt="Screenshot preview" />`;
}

async function startRecording() {
  setActivity("requesting microphone");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordedChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);

    state.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    });

    state.mediaRecorder.addEventListener("stop", async () => {
      const blob = new Blob(state.recordedChunks, {
        type: state.recordedChunks[0]?.type || "audio/webm"
      });
      stream.getTracks().forEach((track) => track.stop());
      await transcribeRecording(blob);
    });

    state.mediaRecorder.start();
    startRecordingButton.disabled = true;
    stopRecordingButton.disabled = false;
    setActivity("recording");
  } catch (error) {
    setActivity(`recording failed: ${error.message}`);
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") {
    return;
  }

  state.mediaRecorder.stop();
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
  setActivity("transcribing");
}

async function transcribeRecording(blob) {
  try {
    const audioBase64 = await blobToDataUrl(blob);
    const payload = await postJson("/api/transcribe", {
      audioBase64,
      mimeType: blob.type || "audio/webm"
    });
    promptElement.value = payload.transcript || "";
    setActivity(`transcript inserted · ${formatTimingSummary(payload.timings)}`);
  } catch (error) {
    setActivity(`transcript failed: ${error.message}`);
  }
}

async function askAssistant() {
  const prompt = promptElement.value.trim();
  if (!prompt) {
    setActivity("enter a prompt first");
    return;
  }

  setActivity("asking Domovik");
  responseElement.textContent = "working …";

  try {
    const payload = await postJson("/api/chat", {
      prompt,
      screenshotDataUrl: state.screenshotDataUrl,
      conversationHistory: useConversationElement.checked ? state.conversationHistory : []
    });

    responseElement.textContent = payload.reply || "no reply";

    if (
      payload.mode === "anthropic" ||
      payload.mode === "openai_compat" ||
      payload.mode === "minimax" ||
      payload.mode === "openclaw"
    ) {
      state.conversationHistory.push({
        user: prompt,
        assistant: payload.reply || ""
      });
      state.conversationHistory = state.conversationHistory.slice(-10);
      renderHistory();
    }

    if (payload.outputFilePath) {
      setActivity(`done · ${formatTimingSummary(payload.timings)} · log: ${payload.outputFilePath}`);
    } else {
      setActivity(`done · ${formatTimingSummary(payload.timings)}`);
    }

    if (speakResponseElement.checked && payload.reply) {
      await playSpeech(payload.reply);
    }
  } catch (error) {
    responseElement.textContent = error.message;
    setActivity(`error: ${error.message}`);
  }
}

async function playSpeech(text) {
  try {
    const payload = await postJson("/api/tts", { text });
    audioPlayerElement.src = `data:${payload.mimeType};base64,${payload.audioBase64}`;
    await audioPlayerElement.play();
  } catch (_error) {
  }
}

function clearConversationHistory() {
  state.conversationHistory = [];
  renderHistory();
  setActivity("history cleared");
}

function renderHistory() {
  if (!state.conversationHistory.length) {
    historyElement.className = "history-list empty";
    historyElement.textContent = "no conversation yet";
    return;
  }

  historyElement.className = "history-list";
  historyElement.innerHTML = state.conversationHistory
    .map(
      (entry) => `
        <article class="history-entry">
          <p><strong>you</strong><span>${escapeHtml(entry.user)}</span></p>
          <p><strong>${escapeHtml(defaultAssistantName)}</strong><span>${escapeHtml(entry.assistant)}</span></p>
        </article>
      `
    )
    .join("");
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function setActivity(message) {
  activityElement.textContent = message;
}

function formatTimingSummary(timings) {
  if (!timings || typeof timings !== "object") {
    return "timing unavailable";
  }

  const parts = [];
  if (Number.isFinite(timings.providerMs)) {
    parts.push(`provider ${formatMilliseconds(timings.providerMs)}`);
  }
  if (Number.isFinite(timings.totalMs)) {
    parts.push(`total ${formatMilliseconds(timings.totalMs)}`);
  }
  return parts.length ? parts.join(" · ") : "timing unavailable";
}

function formatMilliseconds(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) {
    return "n/a";
  }
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }
  return `${Math.round(milliseconds)}ms`;
}

function fitWithinMaxEdge(sourceWidth, sourceHeight, maxEdge) {
  if (!sourceWidth || !sourceHeight) {
    return { width: sourceWidth, height: sourceHeight };
  }

  if (!maxEdge || maxEdge <= 0) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const largestEdge = Math.max(sourceWidth, sourceHeight);
  if (largestEdge <= maxEdge) {
    return { width: sourceWidth, height: sourceHeight };
  }

  const scale = maxEdge / largestEdge;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("could not load image"));
    image.src = dataUrl;
  });
}

async function downscaleImageDataUrl(dataUrl) {
  if (!dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const { width, height } = fitWithinMaxEdge(image.width, image.height, maxScreenshotEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", screenshotJpegQuality);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
