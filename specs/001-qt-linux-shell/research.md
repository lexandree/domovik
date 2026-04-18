# Research: Qt Linux Desktop Shell

## Decision: Use Qt via PySide6 for the first native Linux shell

### Rationale

- Qt is a better fit than a browser shell when the priority is native desktop behaviour.
- Official Qt APIs directly cover important primitives such as tray icons and screenshots.
- Python keeps iteration speed high while allowing a clean shell layer separate from the Node runtime.

### Alternatives Considered

- **Electron**: fastest reuse of current browser UI, but too heavy for a utility-style local assistant and not aligned with the current goal.
- **Tauri v2**: lighter than Electron and credible, but still webview-centric and less clearly native-first than Qt for this project direction.
- **GTK4/libadwaita**: very Linux-native, but more expensive for tray and cross-desktop behaviour.

## Decision: Keep the current Node runtime as the orchestration core

### Rationale

- The current runtime already contains Anthropic, ElevenLabs, Whisper, trigger parsing, and CLI handoff logic.
- Reusing it reduces risk while the shell layer is changing.
- A stable shell-to-runtime bridge gives flexibility for future rewrites.

### Alternatives Considered

- **Full Python rewrite now**: cleaner end state, but too much risk and too much simultaneous change.

## Decision: Treat the browser UI as a temporary debug surface

### Rationale

- The browser UI is useful for debugging and fallback access.
- It should not define the final interaction model.

## Decision: Use the shell for native capture and system integration only

### Rationale

- Tray, overlay, screenshots, microphone initiation, and hotkeys belong in the shell.
- LLM calls, STT/TTS orchestration, and local agent handoffs belong in the runtime.

## Open Risks

- Global shortcuts on Linux may require an extra library or compositor-specific workaround beyond plain Qt.
- Overlay behaviour can differ between desktop environments and compositors.
- Screenshot capture may need adaptation for X11 versus Wayland.

## Implementation Note Discovered During Spike

- On the target Ubuntu GNOME machine, the `qgtk3` Qt platform theme plugin crashes against the local `org.gnome.settings-daemon.plugins.xsettings` schema because the `antialiasing` key is missing.
- The shell successfully starts when `libqgtk3.so` is excluded from the platform theme search path.
- The shell bootstrap therefore needs to disable `libqgtk3.so` inside the active Python environment before Qt loads, and prefer `xdgdesktopportal` plus `Fusion`.
