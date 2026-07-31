# Contributing Guide

Thanks for helping improve JavdBviewed. This project is a Chromium browser extension.

## Development Setup

Use pnpm for dependency management. The repository declares the expected package manager in `package.json`.

```bash
pnpm install
pnpm run build
```

Load the generated `dist/` directory as an unpacked extension in Chrome or Edge.

## Useful Commands

```bash
pnpm run typecheck
pnpm run test
pnpm run test:unit
pnpm run test:regression
pnpm run test:dom
pnpm run test:coverage
pnpm run build
```

Run `pnpm run ci` before opening a larger pull request. It runs the same core checks used by GitHub Actions.

## Project Map

- `src/background/`: service worker, message routing, storage, long-running tasks
- `src/content/`: injected page scripts and site enhancements
- `src/dashboard/`: extension dashboard, settings, records, actors, logs
- `src/services/`: business services shared across pages and background code
- `src/utils/`: shared helpers, configuration, parsing, storage utilities
- `src/types/`: shared TypeScript types
- `scripts/`: build, release, and regression scripts

## Pull Request Expectations

- Keep pull requests focused on one user-visible change or one internal cleanup.
- Include manual test steps in the PR body.
- Add or update tests for logic, data migration, sync, privacy, and task orchestration changes.
- Update the [documentation repository](https://github.com/JavdBviewed/JavdBviewed-Docs) when behavior, setup, settings, permissions, or user workflows change.
- For UI changes, include before/after screenshots or a short recording.
- For storage changes, describe migration and rollback impact.

## Coding Guidelines

- Prefer existing module boundaries and helper APIs.
- Keep browser-specific calls behind the existing background/content/dashboard boundaries.
- Use typed message payloads for cross-context communication.
- Keep comments focused on intent, invariants, browser quirks, and external service constraints.
- Route runtime logging through the project logging utilities when practical.

## Testing Notes

`pnpm run test` runs the CI test set: unit tests plus regression tests. Use `pnpm run test:dom` for browser-like tests that need `window`, `document`, or Chrome API mocks. Use `pnpm run test:coverage` when you need a coverage report under `coverage/`. Keep new pure logic tests in the unit set when possible, and place behavior regressions that guard past bugs under `tests/regression/`.

## Issue Triage

Good starter tasks should be small, reproducible, and labeled `good first issue`. A strong issue includes extension version, browser, operating system, reproduction steps, expected behavior, actual behavior, and console logs when relevant.
