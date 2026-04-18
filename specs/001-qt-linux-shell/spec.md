# Feature Specification: Qt Linux Desktop Shell

**Feature Branch**: `001-qt-linux-shell`  
**Created**: 2026-04-16  
**Status**: Baseline implemented  
**Input**: User description: "Build a native Linux desktop shell with Qt and PySide6 for tray, overlay, global push-to-talk, microphone, and screen capture"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Background companion shell (Priority: P1)

As a Linux user, I want Domovik to run as a tray-resident desktop app with a visible overlay companion so I can use it like the original desktop apps instead of keeping a browser tab open.

**Why this priority**: This restores the defining native interaction model of the original apps.

**Independent Test**: Launch the desktop app, verify tray icon exists, open and close the panel from the tray, and verify the overlay companion window appears without using a browser.

**Acceptance Scenarios**:

1. **Given** the native shell is launched, **When** the app starts, **Then** a tray icon is created and the shell stays resident without a browser window.
2. **Given** the shell is running, **When** the user toggles companion visibility, **Then** the overlay window appears or hides without terminating the background app.

---

### User Story 2 - Voice trigger workflow (Priority: P1)

As a Linux user, I want a global push-to-talk workflow so I can talk to Domovik while I work in other apps.

**Why this priority**: Global push-to-talk is one of the key behaviours from both originals.

**Independent Test**: Register a global hotkey, press and hold it while another app is focused, verify microphone recording begins, and verify the resulting transcript reaches the runtime.

**Acceptance Scenarios**:

1. **Given** the shell is running in the background, **When** the user presses the configured push-to-talk key, **Then** microphone capture starts without focusing the shell window.
2. **Given** microphone capture is active, **When** the user releases the push-to-talk key, **Then** the shell finalizes the recording and submits it for transcription.

---

### User Story 3 - Screenshot-aware interaction (Priority: P1)

As a Linux user, I want Domovik to capture my current screen context directly from the desktop shell so I can ask screenshot-aware questions without browser screen-sharing prompts.

**Why this priority**: Screenshot-aware assistance is a core capability from the original apps.

**Independent Test**: With the shell running, trigger a screenshot-aware request and verify the current screen image is captured and sent to the existing runtime.

**Acceptance Scenarios**:

1. **Given** the shell is running, **When** the user submits a screenshot-aware request, **Then** the shell captures the current display image without needing a browser tab.
2. **Given** a multi-monitor setup, **When** the pointer is on a specific screen, **Then** the shell prioritizes that screen for screenshot-aware requests.

---

### User Story 4 - Local agent handoffs from native shell (Priority: P2)

As a Linux user, I want the native shell to preserve Codex, Claude Code, and OpenClaw handoffs so that desktop improvements do not remove the local-first orchestration workflow.

**Why this priority**: The Linux port must not regress on the existing local agent workflow.

**Independent Test**: Speak or type a supported trigger phrase and verify the shell sends the command to the existing runtime, which launches the matching CLI handoff.

**Acceptance Scenarios**:

1. **Given** the shell is connected to the runtime, **When** the user uses a supported handoff trigger, **Then** the correct CLI integration starts and logs are written to `codex output/`.

## Edge Cases

- What happens when the global shortcut is already claimed by another application?
- What happens when the compositor or desktop environment limits transparent overlay behaviour?
- What happens when screenshot capture permissions or portal access fail?
- What happens when the Node runtime is unavailable or crashes after the shell starts?
- What happens when microphone devices are missing or busy?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a native Linux desktop shell separate from the temporary browser UI.
- **FR-002**: The system MUST create a tray-resident application entry point for the native shell.
- **FR-003**: The system MUST provide a transparent always-on-top companion overlay window.
- **FR-004**: The system MUST support a configurable global push-to-talk shortcut.
- **FR-005**: The system MUST capture microphone input from the native shell and submit it to the existing runtime transcription flow.
- **FR-006**: The system MUST capture the current screen directly from the native shell without relying on manual browser screen sharing.
- **FR-007**: The system MUST preserve the existing Anthropic, ElevenLabs, Whisper, and CLI handoff logic in the current runtime.
- **FR-008**: The system MUST communicate with the existing runtime through a stable local interface instead of duplicating business logic in the shell.
- **FR-009**: The system MUST preserve multilingual trigger handling for German, English, and Russian.
- **FR-010**: The system MUST continue to log local runs and artifacts into the current repository paths.
- **FR-011**: The system MUST expose a development path that works on Ubuntu without requiring a browser UI.

### Key Entities *(include if feature involves data)*

- **DesktopShellSession**: Represents one running native shell instance, including tray lifecycle, overlay state, and runtime bridge state.
- **OverlayState**: Represents companion visibility, position, response bubble state, and current visual mode.
- **PushToTalkSession**: Represents one microphone capture session triggered by a global hotkey.
- **RuntimeBridge**: Represents the local IPC or HTTP connection between the Qt shell and the existing runtime.
- **ShellSettings**: Represents shell-specific preferences such as hotkey, overlay visibility, and startup behaviour.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can launch the native shell and interact with tray and overlay without opening a browser.
- **SC-002**: The shell can start a push-to-talk recording from a background global shortcut in under 250 ms on the target Ubuntu machine.
- **SC-003**: A screenshot-aware request from the native shell succeeds without browser screen-sharing prompts.
- **SC-004**: Existing local handoff commands remain usable from the native shell without removing current runtime capabilities.

## Assumptions

- The current Node runtime remains the core orchestration layer during the first native-shell milestone.
- Ubuntu is the primary target desktop environment for the first native release.
- Additional Python packages may be installed locally for the shell.
- Some Linux desktop features may require iterative tuning across different compositors.
