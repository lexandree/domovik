# ADR 0001: Linux Shell Evaluation

## Status

Proposed

## Context

Domovik currently has a working local Node runtime and browser UI. The next step is to recover original desktop behaviours on Linux:

- tray icon
- transparent overlay
- always-on-top companion
- global push-to-talk
- microphone and screenshot capture

The shell choice will strongly affect delivery speed, native behaviour quality, and future maintenance.

## Options Considered

### Electron

Pros:

- fastest path from the current Node/web code
- mature APIs for tray, global shortcuts, transparent windows, desktop capture, and audio
- easy incremental migration from the current browser UI

Cons:

- high RAM and disk footprint
- large Chromium attack and update surface
- common criticism around bloat is justified for small utilities

### Tauri v2

Pros:

- substantially lighter than Electron
- official support for tray and global shortcut plugins
- web frontend can still be reused
- better default security posture than a broad Electron shell

Cons:

- more moving parts: Rust + web frontend
- advanced Linux-native behaviour may still require custom Rust work
- Linux webview behaviour can vary more than Chromium-based shells

### Qt / PySide6

Pros:

- strong Linux desktop fit
- official support for system tray via `QSystemTrayIcon`
- official support for screenshots via `QScreen::grabWindow()`
- transparent and always-on-top windows are well supported
- better native feel than a webview shell

Cons:

- much larger rewrite from the current Node/browser shell
- global shortcuts are not a clear first-class Qt feature in the official docs, so native glue or an extra library is likely needed
- UI would need to move away from the current browser app

### GTK4 / libadwaita

Pros:

- most Linux-native direction
- best alignment with GNOME look and feel
- good fit if Linux becomes the permanent primary target

Cons:

- tray support is less straightforward across Linux desktop environments
- transparent overlay and global shortcut behaviour are more compositor- and desktop-dependent
- highest implementation cost from the current codebase

### Wails

Pros:

- lighter than Electron
- Go backend can be attractive for long-term systems code
- official docs show tray and window control support

Cons:

- less obvious path for advanced desktop integration than Electron or Qt
- weaker fit with the current Node runtime
- likely more platform-specific work for the harder native pieces

## Recommendation

Use a two-step strategy:

1. Adopt the spec-first split between `core runtime` and `linux desktop shell`.
2. Target **Tauri v2** if we want the fastest credible path to native Linux behaviour without Electron.
3. Target **Qt / PySide6** if we decide that Linux-native fidelity is more important than implementation speed and reuse of the current frontend.

## Current Leaning

For this repository, the best default path is:

- keep the current Node runtime as the core
- replace the browser-only shell with a native Linux shell
- prefer **Tauri v2** over Electron for the first native shell
- reconsider **Qt / PySide6** only if Tauri hits hard limits around overlay or shortcut behaviour on the target desktop environments

## Notes

This decision is intentionally not final. The next concrete step should be a short spike proving:

- tray icon
- transparent always-on-top overlay
- global push-to-talk
- screenshot capture

on the actual target Linux desktop environment.
