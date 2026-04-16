# Zippy For Linux

Diese Linux-Version ersetzt die WinForms-App durch eine lokale Web-Oberfläche, die auf Ubuntu direkt mit Node.js läuft.

## Was funktioniert

- lokaler Browser-Client auf `127.0.0.1`
- Screenshot im Browser aufnehmen oder Bild hochladen
- Text-Prompts an Anthropic senden, optional mit Screenshot
- Spracheingabe via Browser-Mikrofon und Transkription über ElevenLabs oder lokales Whisper
- ElevenLabs-TTS für Antworten
- one-shot handoffs an `codex`, `claude` und `openclaw`
- Logs in `codex output/`

## Was noch nicht auf Linux portiert ist

- immer sichtbares Cursor-Companion-Overlay
- globale Push-to-talk-Hotkeys
- Tray-Icon
- Windows-spezifische Cursor-Navigation und Screen-Erkennung

## Start

1. `cp linux/.env.example linux/.env`
2. `npm run start:linux`
3. `http://127.0.0.1:3000` im Browser öffnen

## Konfiguration

Die relevanten Variablen stehen in `linux/.env.example`.

- `ANTHROPIC_API_KEY`: Haupt-LLM mit Screenshot-Verständnis
- `ANTHROPIC_MODEL`: Default `claude-sonnet-4-20250514`
- `ELEVENLABS_API_KEY`: TTS und optional STT
- `ELEVENLABS_VOICE_ID`: verwendete Stimme
- `ELEVENLABS_STT_KEYTERMS`: optionale Schlüsselbegriffe für bessere STT-Erkennung von Kommandowörtern wie `Codex`, `Claude Code`, `OpenClaw`
- `STT_PROVIDER`: `elevenlabs` oder `whisper`
- `WHISPER_*`: nur für lokales Whisper nötig
- `CODEX_COMMAND`, `CLAUDE_CODE_COMMAND`, `OPENCLAW_COMMAND`: lokale CLI-Binaries
- `CODEX_WORKDIR`: Zielordner für Agent-Läufe, Default `../playground`
- `OPENCLAW_GATEWAY_URL`, `GATEWAY_TOKEN`: nur für OpenClaw

## Handoffs

- `nimm codex ...`
- `nimm codex mit screen ...`
- `use codex ...`
- `run codex with screenshot ...`
- `запусти codex ...`
- `передай openclaw ...`
- `nimm claude code ...`
- `nimm openclaw ...`

`nimm codex mit screen ...` speichert den aktuell im Browser aufgenommenen Screenshot temporär nach `codex output/screen captures/` und hängt ihn an den Lauf an.
