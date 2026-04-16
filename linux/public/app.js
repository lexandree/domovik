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

document.querySelector("#refresh-status").addEventListener("click", loadStatus);
document.querySelector("#capture-screen").addEventListener("click", captureScreen);
document.querySelector("#clear-screen").addEventListener("click", clearScreenshot);
document.querySelector("#ask-button").addEventListener("click", askZippy);
document.querySelector("#clear-history").addEventListener("click", clearConversationHistory);
document.querySelector("#start-recording").addEventListener("click", startRecording);
document.querySelector("#stop-recording").addEventListener("click", stopRecording);
imageUploadElement.addEventListener("change", handleImageUpload);

loadStatus();
renderHistory();

async function loadStatus() {
  setActivity("lade status");
  try {
    const response = await fetch("/api/status");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Status konnte nicht geladen werden.");
    }

    statusGridElement.innerHTML = "";
    appendStatusCard("Env-Datei", payload.envFilePath);
    appendStatusCard("Port", String(payload.port));
    appendStatusCard("Anthropic", payload.anthropicConfigured ? `ok · ${payload.anthropicModel}` : "fehlt");
    appendStatusCard("ElevenLabs", payload.elevenLabsConfigured ? "ok" : "fehlt");
    appendStatusCard("Voice ID", payload.elevenLabsVoiceConfigured ? "ok" : "fehlt");
    appendStatusCard("STT", payload.speechToTextProvider);
    appendStatusCard("Codex", payload.codexCommand);
    appendStatusCard("Claude Code", payload.claudeCodeCommand);
    appendStatusCard("OpenClaw", payload.openClawCommand);
    appendStatusCard("Workdir", payload.codexWorkingDirectory);
    appendStatusCard("Logs", payload.codexOutputDirectory);
    setActivity("bereit");
  } catch (error) {
    setActivity(error.message);
  }
}

function appendStatusCard(label, value) {
  const card = document.createElement("article");
  card.className = "status-card";
  card.innerHTML = `<span>${label}</span><strong>${escapeHtml(value)}</strong>`;
  statusGridElement.appendChild(card);
}

async function captureScreen() {
  setActivity("warte auf screen-freigabe");
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

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    state.screenshotDataUrl = canvas.toDataURL("image/jpeg", 0.92);

    video.pause();
    stream.getTracks().forEach((track) => track.stop());
    renderScreenshotPreview();
    setActivity("screen gespeichert");
  } catch (error) {
    setActivity(`screen fehlgeschlagen: ${error.message}`);
  }
}

function clearScreenshot() {
  state.screenshotDataUrl = "";
  imageUploadElement.value = "";
  renderScreenshotPreview();
  setActivity("screen entfernt");
}

function handleImageUpload(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.screenshotDataUrl = reader.result;
    renderScreenshotPreview();
    setActivity("bild geladen");
  };
  reader.readAsDataURL(file);
}

function renderScreenshotPreview() {
  if (!state.screenshotDataUrl) {
    capturePreviewElement.className = "capture-preview empty";
    capturePreviewElement.textContent = "kein screenshot ausgewählt";
    return;
  }

  capturePreviewElement.className = "capture-preview";
  capturePreviewElement.innerHTML = `<img src="${state.screenshotDataUrl}" alt="Screenshot-Vorschau" />`;
}

async function startRecording() {
  setActivity("mikrofon anfragen");
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
    setActivity("aufnahme läuft");
  } catch (error) {
    setActivity(`aufnahme fehlgeschlagen: ${error.message}`);
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") {
    return;
  }

  state.mediaRecorder.stop();
  startRecordingButton.disabled = false;
  stopRecordingButton.disabled = true;
  setActivity("transkribiere");
}

async function transcribeRecording(blob) {
  try {
    const audioBase64 = await blobToDataUrl(blob);
    const payload = await postJson("/api/transcribe", {
      audioBase64,
      mimeType: blob.type || "audio/webm"
    });
    promptElement.value = payload.transcript || "";
    setActivity("transkript übernommen");
  } catch (error) {
    setActivity(`transkript fehlgeschlagen: ${error.message}`);
  }
}

async function askZippy() {
  const prompt = promptElement.value.trim();
  if (!prompt) {
    setActivity("bitte erst einen prompt eingeben");
    return;
  }

  setActivity("frage zippy");
  responseElement.textContent = "arbeite …";

  try {
    const payload = await postJson("/api/chat", {
      prompt,
      screenshotDataUrl: state.screenshotDataUrl,
      conversationHistory: useConversationElement.checked ? state.conversationHistory : []
    });

    responseElement.textContent = payload.reply || "keine antwort";

    if (payload.mode === "anthropic" || payload.mode === "openclaw") {
      state.conversationHistory.push({
        user: prompt,
        assistant: payload.reply || ""
      });
      state.conversationHistory = state.conversationHistory.slice(-10);
      renderHistory();
    }

    if (payload.outputFilePath) {
      setActivity(`fertig · log: ${payload.outputFilePath}`);
    } else {
      setActivity("fertig");
    }

    if (speakResponseElement.checked && payload.reply) {
      await playSpeech(payload.reply);
    }
  } catch (error) {
    responseElement.textContent = error.message;
    setActivity(`fehler: ${error.message}`);
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
  setActivity("verlauf gelöscht");
}

function renderHistory() {
  if (!state.conversationHistory.length) {
    historyElement.className = "history-list empty";
    historyElement.textContent = "noch keine unterhaltung";
    return;
  }

  historyElement.className = "history-list";
  historyElement.innerHTML = state.conversationHistory
    .map(
      (entry) => `
        <article class="history-entry">
          <p><strong>du</strong><span>${escapeHtml(entry.user)}</span></p>
          <p><strong>zippy</strong><span>${escapeHtml(entry.assistant)}</span></p>
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
    throw new Error(payload.error || "Anfrage fehlgeschlagen.");
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
