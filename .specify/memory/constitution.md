<!--
Sync Impact Report:
- Version change: template -> 1.0.0
- Modified principles:
  - template placeholders -> I. Local-First User Control
  - template placeholders -> II. Grounded Point-and-Ask Assistance
  - template placeholders -> III. Runtime/Shell Boundary Integrity
  - template placeholders -> IV. Fast Path First, Bounded Orchestration Second
  - template placeholders -> V. Spec-Driven Delivery with Proportionate Validation
- Added sections:
  - Product & Repository Constraints
  - Workflow & Review
- Removed sections:
  - none
- Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ updated
  - .specify/templates/spec-template.md: ✅ updated
  - .specify/templates/tasks-template.md: ✅ updated
  - .specify/templates/agent-file-template.md: ✅ verified, no changes needed
- Follow-up TODOs: None
-->

# Domovik Constitution

## Core Principles

### I. Local-First User Control
Domovik MUST remain a local-first Linux desktop companion. Secrets MUST stay in
`linux/.env` or equivalent local environment configuration; generated local state
MUST stay under `linux/data/`; external APIs and remote inference backends are
optional capabilities, not the source of authority for user state. New features
MUST prefer local control, explicit configuration, and reversible behavior over
opaque cloud-side convenience.
Rationale: the product promise is user-controlled local assistance, not a thin
frontend for a remote platform.

### II. Grounded Point-and-Ask Assistance
Domovik MUST optimize for point-and-ask desktop help: the user points at a real
screen region, speaks or types an intent, and receives help grounded in that
context. Screenshot, ROI, OCR, and visual-session flows MUST preserve what was
actually captured; the system MUST refuse or narrow the task when exact reading
is unreliable instead of inventing values. Semantic history, display metadata,
and visual-session state MUST remain separate.
Rationale: the product is only useful if it stays tied to the user’s actual
desktop context and does not hallucinate over screenshots.

### III. Runtime/Shell Boundary Integrity
Desktop-native integration MUST live in `linux/qt_shell/`; orchestration, model
routing, and browser-facing HTTP logic MUST live in `linux/server.js`; the GNOME
extension MUST remain a thin trigger adapter. Cross-layer shortcuts that move
desktop capture or shell-specific logic into the Node runtime, or model-routing
logic into shell widgets, MUST be treated as exceptions that require explicit
justification in the relevant spec or plan.
Rationale: the Linux shell, runtime, and GNOME adapter evolve at different
speeds and need clear boundaries to stay debuggable.

### IV. Fast Path First, Bounded Orchestration Second
Core user flows MUST prefer the simplest reliable path first. Deterministic or
low-latency paths (direct text, direct vision, explicit screenshot tools, direct
search) take precedence over generic orchestration layers. Agentic loops, MCP
adapters, and exploratory tool use MAY be added only as bounded, optional layers
with explicit limits, fallback behavior, and observable mode reporting.
Rationale: Domovik is a desktop companion; responsiveness and predictable
behavior matter more than premature generality.

### V. Spec-Driven Delivery with Proportionate Validation
Material product, architecture, workflow, or repository changes MUST begin in
`specs/` and be reflected in plan/tasks artifacts before implementation. Every
change MUST include validation proportional to risk: syntax checks for narrow
edits, runtime or UI smoke tests for behavior changes, and explicit screenshot /
voice / routing checks for desktop-path work. Tasks MUST use exact file paths,
and any feature that changes grounding, capture, routing, or user-visible
behavior MUST document how it was verified or why verification is deferred.
Rationale: this project spans Node, browser UI, PySide6 shell, and external
backends; undocumented improvisation creates regressions too quickly.

## Product & Repository Constraints

- Canonical repository artifacts (`README*`, `AGENTS*`, constitution, specs,
  plans, tasks, research summaries) MUST be written in English unless a file is
  intentionally localized for users.
- Code, comments, logs, prompts, and persisted technical artifacts MUST be in
  English. Interactive chat replies MAY follow the user’s language.
- `linux/server.js` MUST stay dependency-light and MUST justify any new runtime
  dependency in the relevant plan.
- Native Linux integration belongs under `linux/qt_shell/`. GNOME-specific code
  belongs under `linux/gnome_extension/` and MUST not become a second runtime.
- Browser UI is an allowed debug and fallback surface, but desktop-native
  features MUST not be blocked behind the browser when the Qt shell can own them.
- Generated artifacts, debug bundles, logs, and probes MUST live under
  `linux/data/`, `codex output/`, or other ignored local paths, never inside
  canonical docs.
- The repository MUST NOT reintroduce Windows, macOS, or unrelated cloud-worker
  code unless an explicit spec says so.

## Workflow & Review

- Before editing an existing file, contributors MUST inspect nearby docs or code
  that could become inconsistent because of the change.
- Plans MUST include a Constitution Check covering: local-first impact, grounded
  screenshot/ROI behavior, runtime/shell boundary changes, orchestration bounds,
  and planned validation.
- Specs for user-facing features MUST state the target point-and-ask workflow,
  fallback behavior, and any assumptions about capture/search/voice backends.
- Tasks MUST distinguish shared setup, foundational work, story-specific work,
  and polish; they MUST include exact file paths and required validation tasks
  for desktop/runtime behavior changes.
- Reviews MUST check: no secret leakage, no silent boundary erosion between
  runtime and shell, no fabricated exact-reading behavior, no unexplained new
  dependencies, and no missing verification notes for risky paths.
- When repository structure or run flow changes materially, `AGENTS.md`,
  localized guidance, and affected setup docs MUST be updated in the same change.

## Governance

This constitution supersedes conflicting local habits for this repository.
Amendments MUST be made in the same change set as any required template or
guidance updates and MUST include a semantic version bump rationale in the Sync
Impact Report. Versioning follows semantic governance rules: MAJOR for
incompatible principle changes or removals, MINOR for new principles or
materially expanded obligations, PATCH for clarifications that do not alter
required behavior. Compliance review is required for every pull request or
equivalent review before merge.

**Version**: 1.0.0 | **Ratified**: 2026-04-20 | **Last Amended**: 2026-04-20
