# Implementation Plan: Qt Linux Desktop Shell

**Branch**: `001-qt-linux-shell` | **Date**: 2026-04-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-qt-linux-shell/spec.md`

## Summary

Introduce a native Linux desktop shell built with Python and Qt via PySide6. Keep the current Node runtime as the orchestration core and add a Qt shell layer for tray, overlay, screenshot capture, microphone flow, and global push-to-talk.

## Technical Context

**Language/Version**: Python 3.11+ for the native shell, Node.js 24 for the existing runtime  
**Primary Dependencies**: PySide6, existing local Node runtime, Linux desktop integration helpers for global shortcuts if Qt alone is insufficient  
**Storage**: local files in current repo paths  
**Testing**: Python smoke tests, runtime trigger tests, manual desktop verification  
**Target Platform**: Ubuntu Linux desktop  
**Project Type**: desktop app with local runtime bridge  
**Performance Goals**: shell startup under 2 seconds, push-to-talk trigger under 250 ms, overlay response updates without visible lag  
**Constraints**: local-first, preserve current runtime, no browser dependency for main workflow, tolerate Linux compositor quirks  
**Scale/Scope**: one native Linux shell, one local runtime, one primary desktop target first

## Constitution Check

The current constitution file is still a placeholder template, so it does not define enforceable gates yet. Until it is filled in, this feature follows the repo-local rules from `AGENTS.md` and the spec docs in `specs/`.

## Project Structure

### Documentation (this feature)

```text
specs/001-qt-linux-shell/
├── spec.md
├── plan.md
├── research.md
└── quickstart.md
```

### Source Code (repository root)

```text
linux/
├── server.js
├── qt_shell/
│   ├── __init__.py
│   ├── app.py
│   ├── bridge.py
│   ├── overlay.py
│   ├── tray.py
│   └── settings.py
├── tests/
│   └── trigger-normalization.test.js
requirements-desktop.txt
```

**Structure Decision**: Keep runtime orchestration in `linux/server.js` and add a separate `linux/qt_shell/` package for native desktop concerns.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Mixed runtimes (Node + Python) | Fastest path to native shell while preserving working logic | A full rewrite would stall recovery of original behaviours |

