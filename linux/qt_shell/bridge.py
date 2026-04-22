from __future__ import annotations

from dataclasses import dataclass
from urllib import request, error
import base64
import json
import os
from pathlib import Path


@dataclass
class RuntimeStatus:
    ok: bool
    details: dict


class RuntimeBridge:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.chat_timeout_seconds = self._read_chat_timeout_seconds()

    def _read_chat_timeout_seconds(self) -> int:
        raw_value = os.environ.get("DOMOVIK_CHAT_TIMEOUT_SECONDS", "").strip()
        if not raw_value:
            return 120
        try:
            return max(10, int(raw_value))
        except ValueError:
            return 120

    def get_status(self) -> RuntimeStatus:
        status_url = f"{self.base_url}/api/status"
        try:
            with request.urlopen(status_url, timeout=3) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except error.URLError as exc:
            return RuntimeStatus(ok=False, details={"error": str(exc)})
        except Exception as exc:
            return RuntimeStatus(ok=False, details={"error": str(exc)})

        return RuntimeStatus(ok=True, details=payload)

    def ask_chat(
        self,
        prompt: str,
        screenshot_data_url: str = "",
        conversation_history: list[dict] | None = None,
        mode_hint: str = "text",
        agentic_recheck: bool = False,
        roi_selections: list[dict] | None = None,
        search: dict | None = None,
    ) -> dict:
        chat_url = f"{self.base_url}/api/chat"
        request_payload = {
            "prompt": prompt,
            "screenshotDataUrl": screenshot_data_url,
            "conversationHistory": conversation_history or [],
            "modeHint": mode_hint,
            "agenticRecheck": agentic_recheck,
            "roiSelections": roi_selections or [],
            "search": search,
        }

        try:
            request_body = json.dumps(request_payload).encode("utf-8")
            chat_request = request.Request(
                chat_url,
                data=request_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with request.urlopen(chat_request, timeout=self.chat_timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            response_text = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Runtime HTTP error {exc.code}: {response_text}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Runtime connection failed: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Runtime request failed: {exc}") from exc

        return payload

    def clear_visual_session(self) -> dict:
        clear_url = f"{self.base_url}/api/visual-session/clear"
        try:
            request_body = json.dumps({}).encode("utf-8")
            clear_request = request.Request(
                clear_url,
                data=request_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with request.urlopen(clear_request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            response_text = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Runtime HTTP error {exc.code}: {response_text}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Runtime connection failed: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Runtime request failed: {exc}") from exc

        return payload

    def transcribe_audio_file(self, audio_path: Path, mime_type: str = "audio/wav") -> dict:
        transcribe_url = f"{self.base_url}/api/transcribe"
        request_payload = {
          "audioBase64": base64.b64encode(audio_path.read_bytes()).decode("ascii"),
          "mimeType": mime_type,
        }

        try:
            request_body = json.dumps(request_payload).encode("utf-8")
            transcribe_request = request.Request(
                transcribe_url,
                data=request_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with request.urlopen(transcribe_request, timeout=90) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            response_text = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Runtime HTTP error {exc.code}: {response_text}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Runtime connection failed: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Runtime request failed: {exc}") from exc

        transcript = str(payload.get("transcript", "")).strip()
        if not transcript:
            raise RuntimeError("Runtime returned an empty transcript.")
        return payload

    def synthesize_speech(self, text: str) -> dict:
        tts_url = f"{self.base_url}/api/tts"
        request_payload = {
            "text": text,
        }

        try:
            request_body = json.dumps(request_payload).encode("utf-8")
            tts_request = request.Request(
                tts_url,
                data=request_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with request.urlopen(tts_request, timeout=90) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            response_text = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Runtime HTTP error {exc.code}: {response_text}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Runtime connection failed: {exc}") from exc
        except Exception as exc:
            raise RuntimeError(f"Runtime request failed: {exc}") from exc

        audio_base64 = str(payload.get("audioBase64", "")).strip()
        if not audio_base64:
            raise RuntimeError("Runtime returned empty TTS audio.")
        return payload
