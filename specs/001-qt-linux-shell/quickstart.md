# Quickstart: Qt Linux Desktop Shell

## Goal

Run the native Linux shell alongside the existing local runtime.

## Planned Setup

1. Install Python dependencies from `requirements-desktop.txt`.
2. Ensure `linux/.env` is configured for the existing runtime.
3. Start the Node runtime if the shell is not configured to spawn it automatically.
4. Launch the Qt shell entry point.

## Planned Commands

```bash
cp linux/.env.example linux/.env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-desktop.txt
npm run start:linux
python3 -m linux.qt_shell.app
```

## Verification Targets

- tray icon appears
- overlay window appears
- control panel appears
- runtime bridge reports healthy status
- shell can call the existing runtime status endpoint
- shell can start and stop the local runtime
- shell can capture the current screen natively
- shell can send a screenshot-aware prompt to the runtime and show the reply
