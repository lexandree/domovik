const state = {
  visualSession: createEmptyVisualSession(),
  conversationHistory: [],
  latestDisplayReply: createEmptyDisplayReply(),
  activityText: "",
  runtimeStatus: null,
  roiSelectionMode: false,
  roiDraft: null,
  mediaRecorder: null,
  recordedChunks: []
};

const promptElement = document.querySelector("#prompt");
const responseElement = document.querySelector("#response");
const historyElement = document.querySelector("#history");
const activityElement = document.querySelector("#activity");
const capturePreviewElement = document.querySelector("#capture-preview");
const roiStatusElement = document.querySelector("#roi-status");
const statusGridElement = document.querySelector("#status-grid");
const speakResponseElement = document.querySelector("#speak-response");
const webSearchElement = document.querySelector("#web-search");
const agenticRecheckElement = document.querySelector("#agentic-recheck");
const useConversationElement = document.querySelector("#use-conversation");
const imageUploadElement = document.querySelector("#image-upload");
const audioPlayerElement = document.querySelector("#player");
const startRoiButton = document.querySelector("#start-roi");
const clearRoiButton = document.querySelector("#clear-roi");
const startRecordingButton = document.querySelector("#start-recording");
const stopRecordingButton = document.querySelector("#stop-recording");
const maxScreenshotEdge = 2000;
const screenshotJpegQuality = 0.82;
const defaultAssistantName = "Domovik";

document.querySelector("#refresh-status").addEventListener("click", loadStatus);
document.querySelector("#capture-screen").addEventListener("click", captureScreen);
document.querySelector("#clear-screen").addEventListener("click", clearScreenshot);
startRoiButton.addEventListener("click", startRoiSelectionMode);
clearRoiButton.addEventListener("click", clearRoiSelection);
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

    state.runtimeStatus = payload;
    applyAssistantIdentity(payload);
    renderStatusCards();
    setActivity("ready");
  } catch (error) {
    setActivity(error.message);
  }
}

function renderStatusCards() {
  const payload = state.runtimeStatus;
  if (!payload) {
    return;
  }

  const effectiveVisualState = {
    hasScreenshot: state.visualSession.isActive,
    roiCount: state.visualSession.rois?.length || 0
  };

  statusGridElement.innerHTML = "";
  appendStatusCard("Routing mode", payload.activeMode || "text");
  appendStatusCard("Screenshot state", effectiveVisualState.hasScreenshot ? "present" : "empty");
  appendStatusCard("ROI count", String(effectiveVisualState.roiCount));
  appendStatusCard(
    "Last search",
    payload.lastSearch?.used
      ? `${payload.lastSearch.mode} · ${payload.lastSearch.provider || "unknown"} · ${payload.lastSearch.stepCount || 0} steps · ${payload.lastSearch.resultCount || 0} results${payload.lastSearch.query ? ` · ${payload.lastSearch.query}` : ""}`
      : "none"
  );
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
    "Text reachability",
    payload.backendRoutingState?.textBackendAvailable ? "available" : "unavailable"
  );
  appendStatusCard(
    "Vision backend",
    payload.visionProvider === "openai_compat"
      ? (payload.visionBackendConfigured
          ? `ok · ${payload.visionModel}`
          : "missing")
      : (payload.anthropicConfigured
          ? `ok · ${payload.anthropicModel}`
          : "missing")
  );
  appendStatusCard(
    "Vision reachability",
    payload.backendRoutingState?.visionBackendAvailable ? "available" : "unavailable"
  );
  appendStatusCard("Web search", payload.tavilyConfigured ? "tavily ready" : "missing");
  appendStatusCard("Visual session", effectiveVisualState.hasScreenshot ? "present" : "empty");
  appendStatusCard("TTS", payload.textToSpeechProvider || "unknown");
  appendStatusCard("ElevenLabs", payload.elevenLabsConfigured ? "ok" : "missing");
  appendStatusCard("Voice ID", payload.elevenLabsVoiceConfigured ? "ok" : "missing");
  appendStatusCard("STT", payload.speechToTextProvider);
  appendStatusCard("Codex", payload.codexCommand);
  appendStatusCard("Claude Code", payload.claudeCodeCommand);
  appendStatusCard("OpenClaw", payload.openClawCommand);
  appendStatusCard("Workdir", payload.codexWorkingDirectory);
  appendStatusCard("Logs", payload.codexOutputDirectory);
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
    state.visualSession = {
      sessionId: `browser-${Date.now()}`,
      screenshotDataUrl: canvas.toDataURL("image/jpeg", screenshotJpegQuality),
      captureSummary: `captured ${canvas.width}×${canvas.height}`,
      isActive: true,
      rois: []
    };

    video.pause();
    stream.getTracks().forEach((track) => track.stop());
    renderScreenshotPreview();
    renderStatusCards();
    setActivity(`screen captured · ${state.visualSession.captureSummary}`);
  } catch (error) {
    setActivity(`screen failed: ${error.message}`);
  }
}

function clearScreenshot() {
  state.visualSession = createEmptyVisualSession();
  state.roiSelectionMode = false;
  state.roiDraft = null;
  imageUploadElement.value = "";
  if (state.runtimeStatus) {
    state.runtimeStatus.activeMode = "text";
    state.runtimeStatus.visualState = {
      hasScreenshot: false,
      roiCount: 0,
      isActive: false
    };
    state.runtimeStatus.visualSessionActive = false;
    state.runtimeStatus.visualSessionRoiCount = 0;
  }
  renderScreenshotPreview();
  renderStatusCards();
  void clearRuntimeVisualSession();
  setActivity("screenshot context cleared · chat history kept");
}

function handleImageUpload(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imageDataUrl = await downscaleImageDataUrl(String(reader.result || ""));
      const image = await loadImage(imageDataUrl);
      state.visualSession = {
        sessionId: `upload-${Date.now()}`,
        screenshotDataUrl: imageDataUrl,
        captureSummary: `uploaded ${image.width}×${image.height}`,
        isActive: true,
        rois: []
      };
      renderScreenshotPreview();
      renderStatusCards();
      setActivity(`image loaded · ${state.visualSession.captureSummary}`);
    } catch (error) {
      setActivity(`image failed: ${error.message}`);
    }
  };
  reader.readAsDataURL(file);
}

function renderScreenshotPreview() {
  if (!state.visualSession.screenshotDataUrl) {
    capturePreviewElement.className = "capture-preview empty";
    capturePreviewElement.textContent = "no screenshot selected";
    updateRoiStatus();
    return;
  }

  capturePreviewElement.className = "capture-preview";
  capturePreviewElement.innerHTML = `
    <div class="capture-stage">
      <img id="capture-preview-image" src="${state.visualSession.screenshotDataUrl}" alt="Screenshot preview" />
      <div id="roi-overlay" class="roi-overlay" hidden></div>
    </div>
  `;
  attachRoiSelectionHandlers();
  updateRoiStatus();
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
    const wavBlob = await convertBlobToMonoWav(blob);
    const audioBase64 = await blobToDataUrl(wavBlob);
    const payload = await postJson("/api/transcribe", {
      audioBase64,
      mimeType: "audio/wav"
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

  setActivity(buildRequestActivityText());
  responseElement.textContent = "working …";

  try {
    const payload = await postJson("/api/chat", {
      prompt,
      screenshotDataUrl: state.visualSession.screenshotDataUrl,
      roiSelections: state.visualSession.rois,
      conversationHistory: useConversationElement.checked ? state.conversationHistory : [],
      search: webSearchElement.checked ? { mode: "web" } : undefined,
      modeHint: state.visualSession.isActive
        ? (agenticRecheckElement.checked ? "agentic_vision" : "direct_vision")
        : "text",
      agenticRecheck: agenticRecheckElement.checked && state.visualSession.isActive
    });

    const displayReply = normalizeDisplayReply(payload);
    state.latestDisplayReply = displayReply;
    responseElement.textContent = displayReply.displayText || "no reply";
    if (payload.routing && state.runtimeStatus) {
      state.runtimeStatus.activeMode = payload.routing.mode || state.runtimeStatus.activeMode;
    }
    if (payload.visualState && state.runtimeStatus) {
      state.runtimeStatus.visualState = payload.visualState;
      state.runtimeStatus.visualSessionActive = payload.visualState.isActive;
      state.runtimeStatus.visualSessionRoiCount = payload.visualState.roiCount;
    }
    if (payload.search && state.runtimeStatus) {
      state.runtimeStatus.lastSearch = payload.search;
    } else if (state.runtimeStatus && webSearchElement.checked) {
      state.runtimeStatus.lastSearch = {
        used: false,
        mode: "web",
        provider: "tavily",
        resultCount: 0
      };
    }
    renderStatusCards();

    if (
      payload.mode === "anthropic" ||
      payload.mode === "openai_compat" ||
      payload.mode === "minimax" ||
      payload.mode === "web_search" ||
      payload.mode === "openclaw"
    ) {
      state.conversationHistory.push({
        user: prompt,
        assistant: displayReply.plainText || ""
      });
      state.conversationHistory = state.conversationHistory.slice(-10);
      renderHistory();
    }

    setActivity(displayReply.activityText || buildDefaultActivityText(payload));

    if (speakResponseElement.checked && displayReply.plainText) {
      await playSpeech(displayReply.plainText);
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
  setActivity(
    state.visualSession.isActive
      ? "chat history cleared · current screenshot kept"
      : "chat history cleared"
  );
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

async function convertBlobToMonoWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const targetSampleRate = 16000;
    const monoSamples = mixToMono(audioBuffer);
    const resampledSamples = resampleFloat32(monoSamples, audioBuffer.sampleRate, targetSampleRate);
    return new Blob([encodeWavPcm16(resampledSamples, targetSampleRate)], { type: "audio/wav" });
  } finally {
    await audioContext.close();
  }
}

function mixToMono(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  if (channelCount <= 1) {
    return audioBuffer.getChannelData(0);
  }

  const frameCount = audioBuffer.length;
  const mono = new Float32Array(frameCount);
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      mono[frameIndex] += channelData[frameIndex];
    }
  }

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    mono[frameIndex] /= channelCount;
  }
  return mono;
}

function resampleFloat32(samples, sourceSampleRate, targetSampleRate) {
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const resampledLength = Math.max(1, Math.round(samples.length * targetSampleRate / sourceSampleRate));
  const result = new Float32Array(resampledLength);
  const ratio = sourceSampleRate / targetSampleRate;

  for (let index = 0; index < resampledLength; index += 1) {
    const sourceIndex = index * ratio;
    const lowerIndex = Math.floor(sourceIndex);
    const upperIndex = Math.min(lowerIndex + 1, samples.length - 1);
    const interpolation = sourceIndex - lowerIndex;
    const lowerValue = samples[lowerIndex] || 0;
    const upperValue = samples[upperIndex] || 0;
    result[index] = lowerValue + (upperValue - lowerValue) * interpolation;
  }

  return result;
}

function encodeWavPcm16(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    const pcmValue = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(44 + index * bytesPerSample, Math.round(pcmValue), true);
  }

  return buffer;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function setActivity(message) {
  state.activityText = message;
  activityElement.textContent = message;
}

function createEmptyVisualSession() {
  return {
    sessionId: "",
    screenshotDataUrl: "",
    captureSummary: "",
    isActive: false,
    rois: []
  };
}

function createEmptyDisplayReply() {
  return {
    plainText: "",
    displayText: "",
    activityText: ""
  };
}

function normalizeDisplayReply(payload) {
  const display = payload && typeof payload.display === "object" ? payload.display : {};
  const plainText = String(display.plainText || payload?.reply || "").trim();
  const displayText = String(display.displayText || plainText || "no reply").trim();
  const activityText = String(display.activityText || "").trim();
  return {
    plainText,
    displayText,
    activityText
  };
}

function buildDefaultActivityText(payload) {
  const searchPrefix = payload?.search?.used ? `web search · ` : "";
  const routingPrefix = payload?.routing?.mode ? `${payload.routing.mode} · ` : "";
  if (payload.outputFilePath) {
    return `${searchPrefix}${routingPrefix}done · ${formatTimingSummary(payload.timings)} · log: ${payload.outputFilePath}`;
  }
  return `${searchPrefix}${routingPrefix}done · ${formatTimingSummary(payload.timings)}`;
}

function buildRequestActivityText() {
  if (state.visualSession.isActive) {
    const visionProvider = state.runtimeStatus?.visionProvider || "vision backend";
    const mode = agenticRecheckElement.checked ? "agentic_vision" : "direct_vision";
    const searchText = webSearchElement.checked ? " · web search" : "";
    return `asking Domovik · ${mode} via ${visionProvider}${searchText}`;
  }

  const textProvider = state.runtimeStatus?.textProvider || "text backend";
  const searchText = webSearchElement.checked ? " · web search" : "";
  return `asking Domovik · text via ${textProvider}${searchText}`;
}

async function clearRuntimeVisualSession() {
  try {
    await postJson("/api/visual-session/clear", {});
  } catch (_error) {
  }
}

function startRoiSelectionMode() {
  if (!state.visualSession.isActive) {
    setActivity("capture or upload a screenshot first");
    return;
  }

  state.roiSelectionMode = true;
  state.roiDraft = null;
  updateRoiStatus();
  setActivity("drag on the screenshot preview to select an roi");
}

function clearRoiSelection() {
  state.visualSession.rois = [];
  state.roiSelectionMode = false;
  state.roiDraft = null;
  renderScreenshotPreview();
  renderStatusCards();
  setActivity("roi cleared");
}

function attachRoiSelectionHandlers() {
  const imageElement = document.querySelector("#capture-preview-image");
  const overlayElement = document.querySelector("#roi-overlay");
  if (!imageElement || !overlayElement) {
    return;
  }

  let pointerStart = null;

  imageElement.addEventListener("pointerdown", (event) => {
    if (!state.roiSelectionMode) {
      return;
    }

    const rect = imageElement.getBoundingClientRect();
    pointerStart = {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height)
    };
    state.roiDraft = {
      left: pointerStart.x,
      top: pointerStart.y,
      width: 0,
      height: 0
    };
    renderRoiOverlay(overlayElement);
    imageElement.setPointerCapture(event.pointerId);
  });

  imageElement.addEventListener("pointermove", (event) => {
    if (!state.roiSelectionMode || !pointerStart) {
      return;
    }

    const rect = imageElement.getBoundingClientRect();
    const currentX = clamp(event.clientX - rect.left, 0, rect.width);
    const currentY = clamp(event.clientY - rect.top, 0, rect.height);
    state.roiDraft = buildDraftRectangle(pointerStart.x, pointerStart.y, currentX, currentY);
    renderRoiOverlay(overlayElement);
  });

  imageElement.addEventListener("pointerup", async (event) => {
    if (!state.roiSelectionMode || !pointerStart || !state.roiDraft) {
      return;
    }

    imageElement.releasePointerCapture(event.pointerId);
    pointerStart = null;
    const rect = imageElement.getBoundingClientRect();
    const minimumSize = 12;
    if (state.roiDraft.width < minimumSize || state.roiDraft.height < minimumSize) {
      state.roiDraft = null;
      renderRoiOverlay(overlayElement);
      setActivity("roi too small");
      return;
    }

    try {
      const roiSelection = await createRoiSelectionFromDraft(state.roiDraft, rect);
      state.visualSession.rois = [roiSelection];
      state.roiSelectionMode = false;
      state.roiDraft = null;
      renderScreenshotPreview();
      renderStatusCards();
      setActivity(`roi selected · ${roiSelection.width}×${roiSelection.height}`);
    } catch (error) {
      state.roiDraft = null;
      renderRoiOverlay(overlayElement);
      setActivity(`roi failed: ${error.message}`);
    }
  });
}

function renderRoiOverlay(overlayElement) {
  if (!state.roiDraft) {
    overlayElement.hidden = true;
    return;
  }

  overlayElement.hidden = false;
  overlayElement.style.left = `${state.roiDraft.left}px`;
  overlayElement.style.top = `${state.roiDraft.top}px`;
  overlayElement.style.width = `${state.roiDraft.width}px`;
  overlayElement.style.height = `${state.roiDraft.height}px`;
}

function buildDraftRectangle(startX, startY, currentX, currentY) {
  return {
    left: Math.min(startX, currentX),
    top: Math.min(startY, currentY),
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY)
  };
}

async function createRoiSelectionFromDraft(draft, imageRect) {
  const image = await loadImage(state.visualSession.screenshotDataUrl);
  const scaleX = image.width / imageRect.width;
  const scaleY = image.height / imageRect.height;
  const x = Math.max(0, Math.round(draft.left * scaleX));
  const y = Math.max(0, Math.round(draft.top * scaleY));
  const width = Math.max(1, Math.round(draft.width * scaleX));
  const height = Math.max(1, Math.round(draft.height * scaleY));
  const imageDataUrl = await cropImageDataUrl(state.visualSession.screenshotDataUrl, x, y, width, height);

  return {
    roiId: `roi-${Date.now()}`,
    label: "manual roi",
    origin: "manual",
    x,
    y,
    width,
    height,
    imageDataUrl
  };
}

async function cropImageDataUrl(sourceDataUrl, x, y, width, height) {
  const image = await loadImage(sourceDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", screenshotJpegQuality);
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function updateRoiStatus() {
  if (!roiStatusElement) {
    return;
  }
  if (state.roiSelectionMode) {
    roiStatusElement.textContent = "selection active";
    return;
  }
  if (state.visualSession.rois?.length) {
    const roi = state.visualSession.rois[0];
    roiStatusElement.textContent = `${roi.label} · ${roi.width}×${roi.height}`;
    return;
  }
  roiStatusElement.textContent = "no roi selected";
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
