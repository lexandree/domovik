# Feature Specification: Global Push-To-Talk

**Feature Branch**: `002-global-push-to-talk`  
**Created**: 2026-04-17  
**Status**: In progress  
**Input**: User description: "Add native Linux global push-to-talk to the Qt shell so holding a system hotkey starts recording, releasing stops recording, and the captured speech can be transcribed and sent to the runtime without using the browser UI."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Background voice capture (Priority: P1)

As a Linux user, I want to trigger speech capture from the native shell while another app is focused so I can talk to the assistant without switching back to the control panel or browser.

**Why this priority**: This restores one of the highest-value interaction patterns from the original desktop assistants and removes the browser dependency for spoken input.

**Independent Test**: Launch the native shell, focus another application, activate the configured push-to-talk interaction, speak a short sentence, release the interaction, and verify that the transcript reaches the shell and runtime.

**Acceptance Scenarios**:

1. **Given** the shell is running in the background, **When** the user starts the configured push-to-talk interaction, **Then** native microphone capture begins without requiring browser UI focus.
2. **Given** a push-to-talk capture is active, **When** the user stops the configured interaction, **Then** the shell finalizes the recording and sends it to the runtime transcription path.

---

### User Story 2 - Usable feedback during capture (Priority: P1)

As a Linux user, I want visible feedback while speech capture is active so I know whether the shell is listening, processing, or failed.

**Why this priority**: Voice capture is error-prone on Linux desktops, so immediate feedback is required to keep the feature trustworthy.

**Independent Test**: Start and stop a speech capture session and verify that the control panel and overlay clearly show listening, transcribing, success, or failure states.

**Acceptance Scenarios**:

1. **Given** speech capture has started, **When** the shell enters the recording state, **Then** the user sees a listening indicator in the shell.
2. **Given** a recording has ended, **When** transcription succeeds or fails, **Then** the shell shows the resulting transcript or a clear error message.

---

### User Story 3 - Linux environment fallback (Priority: P2)

As a Linux user, I want the shell to degrade gracefully when my desktop session does not allow global shortcuts so I still have a usable native speech path.

**Why this priority**: Wayland and desktop-environment differences make full global shortcut support non-uniform; the feature must stay usable without pretending unsupported capabilities exist.

**Independent Test**: Run the shell in an environment where global shortcut registration is unavailable and verify that the shell exposes a clear fallback path for native recording and explains the limitation.

**Acceptance Scenarios**:

1. **Given** the desktop session does not support the configured global shortcut backend, **When** the shell starts, **Then** it reports that limitation and exposes a manual native push-to-talk fallback.
2. **Given** the fallback path is used, **When** the user records speech, **Then** the transcription and prompt-fill workflow still works without the browser UI.

## Edge Cases

- What happens when no supported microphone capture tool or device is available?
- What happens when the user starts a capture while another capture is already active?
- What happens when the runtime is offline when transcription is requested?
- What happens when the desktop session is Wayland and the chosen global shortcut backend is unsupported?
- What happens when the audio capture process exits unexpectedly before the user stops recording?
- What happens when the recorded audio file is empty or too short to transcribe?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a native push-to-talk workflow in the Qt shell without relying on the browser UI.
- **FR-002**: The system MUST start native microphone capture when the push-to-talk interaction begins.
- **FR-003**: The system MUST stop native microphone capture when the push-to-talk interaction ends.
- **FR-004**: The system MUST send the resulting audio to the existing runtime transcription endpoint.
- **FR-005**: The system MUST surface the transcript back into the native shell so the user can review or send it.
- **FR-006**: The system MUST show shell-visible state transitions for idle, recording, transcribing, and failure.
- **FR-007**: The system MUST prevent overlapping recording sessions.
- **FR-008**: The system MUST preserve a usable native recording fallback when global shortcut registration is unavailable.
- **FR-009**: The system MUST persist push-to-talk preferences in shell settings.
- **FR-010**: The system MUST avoid claiming unsupported global shortcut capabilities on desktops where they are unavailable.
- **FR-011**: The system MUST keep the runtime transcription path unchanged so browser and native flows remain compatible.

### Key Entities *(include if feature involves data)*

- **PushToTalkSession**: Represents a single native voice capture session, including start time, stop time, recorder state, and resulting audio artifact.
- **RecorderBackend**: Represents the local capture mechanism chosen by the shell, including availability and failure state.
- **HotkeyBackendState**: Represents whether the shell has an active global shortcut backend, a degraded fallback, or no hotkey support.
- **TranscriptionResult**: Represents the returned transcript text or transcription failure for a completed audio capture.
- **PushToTalkSettings**: Represents shell-level preferences for shortcut, fallback behaviour, and whether the transcript should auto-send.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can complete a native speech capture and receive a transcript in the Qt shell without opening the browser UI.
- **SC-002**: When native audio capture is available, the shell enters the visible recording state within 300 ms of the user starting push-to-talk.
- **SC-003**: The shell never starts a second simultaneous recording while one is already active.
- **SC-004**: In environments where global shortcut registration is unavailable, the shell still exposes a native fallback speech path and clearly communicates the limitation.

## Assumptions

- Ubuntu remains the primary target environment for the first implementation.
- The tested Ubuntu 24.04 GNOME 46 machine does not currently expose `org.freedesktop.portal.GlobalShortcuts`, so a manual native fallback remains mandatory there.
- Native audio capture can initially rely on existing Linux command-line tools already present on the machine.
- The Node runtime remains the transcription and orchestration backend during this feature.
