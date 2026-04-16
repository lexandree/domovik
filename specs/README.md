# Specs

This directory is the source of truth for product and architecture decisions as Zippy grows from a small local tool into a larger Linux desktop assistant.

## Workflow

1. Start with a problem statement and user outcome.
2. Write or update the relevant spec.
3. If the decision affects architecture, add or update an ADR.
4. Implement against the approved spec, not against chat history.
5. Keep the spec current when reality changes.

## Suggested Structure

- `product/` for user-facing behaviour and feature scope
- `architecture/` for system design and technical constraints
- `adr/` for concrete technical decisions and tradeoffs

## Current Active Specs

- [`product/linux-desktop-vision.md`](product/linux-desktop-vision.md)
- [`architecture/runtime-split.md`](architecture/runtime-split.md)
- [`adr/0001-linux-shell-evaluation.md`](adr/0001-linux-shell-evaluation.md)

