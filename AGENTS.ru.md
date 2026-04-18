# Domovik - Инструкции Для Агентов

`CLAUDE.ru.md` указывает на этот файл.

## Обзор

Этот репозиторий — самостоятельный Linux-порт проекта Domovik, локального desktop-компаньона.

Репозиторий теперь состоит из:

- `core runtime` на Node.js
- формирующейся нативной Linux-оболочки на Python/Qt

Текущий runtime:

- читает API-секреты из `linux/.env`
- раздаёт локальный browser UI из `linux/public/`
- получает screenshots через browser screen sharing или загрузку изображения
- записывает микрофон в браузере
- транскрибирует аудио через ElevenLabs speech-to-text или локальный Whisper
- напрямую вызывает Anthropic для screenshot + vision chat
- напрямую вызывает ElevenLabs для text-to-speech
- может отправлять one-shot запросы в локальный Codex CLI, если prompt начинается с поддерживаемого немецкого, английского или русского trigger для Codex
- может отправлять one-shot запросы в локальный Claude Code CLI, если prompt начинается с поддерживаемого немецкого, английского или русского trigger для Claude Code
- может отправлять one-shot запросы в локальный OpenClaw CLI, если prompt начинается с поддерживаемого немецкого, английского или русского trigger для OpenClaw
- может прикладывать текущий browser screenshot к Codex-запускам для фраз вроде `nimm codex mit screen`, `use codex with screenshot` или `запусти codex со скриншотом`
- использует `playground/` в корне репозитория как default рабочую директорию Codex
- пишет логи запусков в `codex output/`
- хранит несекретное временное состояние в `linux/data/`

Scaffold нативной Linux-оболочки:

- живёт в `linux/qt_shell/`
- построен на Python и PySide6
- отвечает за tray, overlay, runtime bridge и будущую desktop-native интеграцию
- должен забирать native Linux concerns из браузерного UI, а не наоборот

## Ключевые файлы

| Файл | Назначение |
|------|------------|
| `linux/server.js` | Основной backend Linux-версии. Поднимает HTTP-маршруты, запросы к Anthropic, ElevenLabs STT/TTS, запуск Whisper и CLI handoffs. |
| `linux/public/index.html` | Главный браузерный интерфейс. |
| `linux/public/app.js` | Захват screenshots в браузере, запись микрофона, chat-запросы и воспроизведение ответов. |
| `linux/public/styles.css` | Стили Linux UI. |
| `linux/qt_shell/app.py` | Entry point нативной Qt-оболочки. |
| `linux/qt_shell/tray.py` | Контроллер tray icon для нативной оболочки. |
| `linux/qt_shell/overlay.py` | Scaffold прозрачного companion overlay окна. |
| `linux/qt_shell/bridge.py` | Runtime bridge от Qt-shell к Node runtime. |
| `requirements-desktop.txt` | Python-зависимости для нативной оболочки. |
| `linux/.env.example` | Шаблон локальных API-ключей и путей к командам. |
| `linux/README.md` | Англоязычные заметки по запуску Linux-рантайма. |
| `README.md` | Англоязычный обзор standalone Linux-порта. |
| `README.ru.md` | Русскоязычный обзор проекта. |
| `AGENTS.md` | Англоязычная версия этих инструкций. |
| `SOUL.md` | Редактируемый personality layer для prompt ассистента. |
| `NOTICE.md` | Примечание о происхождении и атрибуции. |
| `.gitignore` | Игнорирует локальные секреты, runtime-состояние и артефакты. |

## Сборка И Запуск

```bash
cp linux/.env.example linux/.env
npm run start:linux
```

После этого открой `http://127.0.0.1:3000`.

Планируемый запуск нативной оболочки:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-desktop.txt
python3 -m linux.qt_shell.app
```

## Правила

- Держи репозиторий сфокусированным только на Linux local web app.
- Не возвращай Windows WinForms, macOS AppKit/SwiftUI, Xcode или Cloudflare Worker код без прямой просьбы пользователя.
- Не храни секреты в исходниках. Используй `linux/.env`.
- Храни сгенерированное локальное состояние в `linux/data/`.
- Не коммить `playground/`.
- Не коммить `codex output/`.
- Сохраняй runtime лёгким по зависимостям. Текущая Linux-версия намеренно построена только на встроенных возможностях Node.
- Сохраняй немецкие trigger-фразы, если пользователь не попросил поменять их.
- Держи английскую и русскую поддержку trigger-фраз синхронизированной с общей normalizer-логикой в `linux/server.js`.
- Считай `specs/` источником истины для product scope и архитектурного направления по мере роста проекта.
- Держи нативную Linux desktop-интеграцию внутри `linux/qt_shell/`, если нет явной причины вынести её отдельно.

## Проверка Работоспособности

При существенных изменениях Linux-рантайма предпочитай такую последовательность проверки:

1. `node --check linux/server.js`
2. `node --check linux/public/app.js`
3. `npm run start:linux`
4. `curl -s http://127.0.0.1:3000/health`
5. `curl -s http://127.0.0.1:3000/api/status`

## Самообновление

Если структура Linux-приложения заметно меняется, обнови этот файл.
