# Repository Guidelines

## Project Structure & Module Organization
This is a small Node.js ESM CLI for routing Codex requests before execution. Core source lives in `src/` and is split by responsibility: `cli/index.js` parses commands, `cli/shim.js` and `cli/hud-bin.js` provide executable shims, `router/` classifies prompts and chooses model/effort, `codex/` resolves and builds Codex invocations, and `transports/` contains app-server and exec transport adapters. TUI, HUD, and status-file support live in `ui/`, app-server WebSocket proxying lives in `proxy/`, local usage parsing lives in `usage/`, and `src/index.js` re-exports the public helpers. Tests live in `test/`, with router evaluation data in `test/fixtures/router-eval.json`. `examples/router-config.json` shows router configuration shape.

## Build, Test, and Development Commands
- `npm install` — install local dependencies if any are added; this repo currently has no lockfile.
- `npm test` — run the full Node test suite via `node --test`.
- `node --test test/router.test.js` — run a single test file.
- `npm run route -- "fix this failing test"` — print a routing decision.
- `npm run dry-run -- "fix this failing test"` — preview the selected transport payload without executing Codex.
- `npm link` — expose `codex-shift`, `codex-router`, and related binaries locally for manual CLI testing.

## Coding Style & Naming Conventions
Use modern ESM syntax (`import`/`export`) and keep modules focused around one responsibility. Existing code uses two-space indentation, camelCase for functions and variables, UPPER_CASE for constants, and named exports for shared helpers. There is no configured formatter or linter in `package.json`; match the surrounding style and keep CLI output stable because tests assert exact messages and JSON fields.

## Testing Guidelines
Tests use the built-in `node:test` framework with `node:assert/strict`. Name tests as `*.test.js` under `test/`. Prefer focused unit tests around routing decisions, command construction, JSON-RPC request/response parsing, and shim/proxy behavior. Use temporary directories and fake Codex binaries as existing tests do; do not require a real Codex install for automated tests.

## Commit & Pull Request Guidelines
This checkout may not have committed local history, so use concise, imperative commit subjects that identify the affected area, for example `router: handle read-only prompts`. PRs should describe behavior changes, list the commands run (`npm test`, targeted `node --test ...`), and include sample CLI output when routing, TUI, HUD, or proxy behavior changes.

## Security & Configuration Tips
Do not log full prompts by default. Preserve the existing behavior where route previews omit prompt text unless `--include-prompt` is explicitly passed, and HUD/status files store routing metadata rather than prompt content.
