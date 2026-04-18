# Domovik

Domovik — локальный desktop-компаньон для Linux и Ubuntu.

Этот репозиторий — самостоятельный Linux-порт, собранный из двух проектов-предшественников:

- `farzaa/clicky`, откуда пришла идея ассистента рядом с курсором
- `Arnie936/zippy-windows`, откуда пришли локальная оркестрация агентов, прямые API-вызовы и German trigger workflow

Текущая версия работает как локальный Node.js runtime с браузерным интерфейсом и теперь содержит первый scaffold нативной Qt/PySide6-оболочки для возврата tray, overlay и desktop-native поведения.

Парсер handoff-команд сохраняет немецкие trigger-фразы из `zippy-windows` и дополнительно поддерживает английские и русские формулировки, включая типичные ошибки распознавания речи.

## Возможности

- локальный браузерный интерфейс на `127.0.0.1`
- scaffold нативной Qt/PySide6 оболочки в `linux/qt_shell/`
- захват экрана через browser screen sharing или загрузку изображения
- запись микрофона в браузере
- Anthropic или OpenAI-compatible screenshot + vision chat со своим endpoint и ключами
- ElevenLabs text-to-speech
- speech-to-text через ElevenLabs или локальный Whisper
- одноразовые handoff-запуски в Codex, Claude Code и OpenClaw
- локальные логи запусков в `codex output/`
- редактируемый personality prompt в [`SOUL.md`](SOUL.md)

## Быстрый старт

1. Клонируйте этот репозиторий.
2. Скопируйте пример файла окружения:

```bash
cp linux/.env.example linux/.env
```

3. Заполните `linux/.env` своими API-ключами и путями к локальным командам.
4. Запустите локальный сервер:

```bash
npm run start:linux
```

5. Откройте в браузере:

```text
http://127.0.0.1:3000
```

## Направление Native Shell

Браузерный UI теперь считается временной debug-поверхностью. Основное направление развития — нативная Linux-оболочка на Qt и PySide6.

Текущий scaffold:

- [`linux/qt_shell/app.py`](linux/qt_shell/app.py)
- [`linux/qt_shell/tray.py`](linux/qt_shell/tray.py)
- [`linux/qt_shell/overlay.py`](linux/qt_shell/overlay.py)
- [`linux/qt_shell/bridge.py`](linux/qt_shell/bridge.py)
- [`linux/qt_shell/panel.py`](linux/qt_shell/panel.py)
- [`linux/qt_shell/runtime.py`](linux/qt_shell/runtime.py)
- [`requirements-desktop.txt`](requirements-desktop.txt)

Планируемый локальный запуск:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-desktop.txt
python3 -m linux.qt_shell.app
```

В Qt-shell теперь встроен bootstrap workaround для Ubuntu GNOME `qgtk3` platform-theme crash: он отключает `libqgtk3.so` в активном окружении, и запускать его дальше нужно из `.venv-qt`.
Также shell теперь открывает native control panel для управления overlay и lifecycle локального runtime.
Control panel теперь также умеет нативно захватывать текущий экран и отправлять screenshot-aware prompt прямо в runtime без браузерного UI.

## Обязательные ключи

- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

## Необязательные локальные инструменты

- локальный Whisper через `python3 -m whisper`
- локальный Codex CLI для `nimm codex ...`
- локальный Claude Code CLI для `nimm claude code ...`
- локальный OpenClaw CLI для `nimm openclaw ...`

## Архитектура

Linux-порт намеренно не пытается запускать Windows WinForms-оболочку на Ubuntu. Вместо этого он заменяет платформенно-зависимый UI на безопасный для Linux локальный web runtime:

- `linux/server.js` поднимает локальный HTTP-сервер и API-маршруты
- `linux/public/` содержит браузерный интерфейс
- `linux/.env` хранит локальную конфигурацию
- `SOUL.md` задаёт personality prompt ассистента
- `codex output/` хранит логи handoff-запусков и временные screenshots

## Структура проекта

```text
linux/
  server.js
  .env.example
  README.md
  public/
SOUL.md
LICENSE
NOTICE.md
```

## Триггерные фразы

- `nimm codex ...`
- `nimm codex mit screen ...`
- `use codex ...`
- `run codex with screenshot ...`
- `запусти codex ...`
- `передай openclaw ...`
- `nimm claude code ...`
- `nimm openclaw ...`

## Текущие ограничения

- пока нет tray icon
- пока нет global push-to-talk hotkey
- пока нет always-on cursor overlay
- пока нет анимированной навигации по `[POINT:...]`
- speech и vision зависят от доступности внешних API

## Документация

- Описание рантайма на английском: [`linux/README.md`](linux/README.md)
- Инструкции для агентных инструментов: [`AGENTS.md`](AGENTS.md)
- Обзор на русском: [`README.ru.md`](README.ru.md)
- Инструкции для агентов на русском: [`AGENTS.ru.md`](AGENTS.ru.md)
- Спеки и архитектурные заметки: [`specs/README.md`](specs/README.md)
- Спека Qt-shell: [`specs/001-qt-linux-shell/spec.md`](specs/001-qt-linux-shell/spec.md)

## Лицензия

MIT. См. [`LICENSE`](LICENSE) и [`NOTICE.md`](NOTICE.md).
