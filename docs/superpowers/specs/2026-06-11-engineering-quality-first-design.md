# Engineering Quality First Design

## Context

`codex-shift` is already useful as a local Codex CLI router, but the current
implementation is not yet shaped for a durable public release. The strongest
near-term risk is not missing npm metadata. It is that the main CLI and proxy
modules have become too broad, while `src/index.js` exports most internal
modules as if they were public API.

The current test suite is a good baseline. `npm test` passes with 141 tests,
including router classification, CLI preview and turn behavior, proxy rewrite
behavior, HUD status behavior, shim behavior, and TUI command planning.

This design prioritizes maintainability and verification before publication.
The open-source and npm packaging work remains important, but it should happen
after the internal boundaries are stable enough to document and support.

## Goals

- Split the oversized CLI entrypoint into smaller command, argument, help, and
  preview modules without changing user-facing behavior.
- Split the oversized proxy module into transport, JSON-RPC rewrite, status,
  tracing, and WebSocket frame responsibilities.
- Introduce a future stable public API facade without removing the current
  compatibility exports.
- Preserve existing behavior and privacy guarantees throughout the refactor.
- Keep every phase independently testable with `node --test`.

## Non-Goals

- Do not publish the npm package in this workstream.
- Do not rename the package or remove existing bin aliases.
- Do not add Docker, Homebrew, or binary installers.
- Do not introduce a real semantic classifier.
- Do not convert router rules to a fully data-driven system in the first two
  phases.
- Do not add `wss://` or authentication to the proxy while the proxy boundary
  is still being extracted.

## Proposed Phases

### Phase 1: CLI Decomposition

The CLI entrypoint should become a thin executable shell that delegates to
focused modules.

Proposed files:

- `src/cli/index.js`: executable entrypoint, top-level error handling, and
  process exit mapping.
- `src/cli/args.js`: `parseArgs`, `parseProxyArgs`, `parseTuiArgs`, validation
  helpers, and transport resolution.
- `src/cli/help.js`: `printHelp`, `printProxyHelp`, and `printTuiHelp`.
- `src/cli/preview.js`: `buildTransportPreview`, preview rendering, and shell
  quoting.
- `src/cli/commands.js`: `runMainCommand`, `runProxyCli`, and command dispatch.

Behavior must stay stable. Existing command output is part of the CLI contract
because tests and users rely on exact preview fields, routing summaries, and
JSON output shape.

### Phase 2: Proxy Decomposition

The proxy should be split by protocol responsibility instead of by helper size.
`remote-proxy.js` should remain the public proxy entrypoint, but most internal
logic should move to smaller modules.

Proposed files:

- `src/proxy/remote-proxy.js`: `startRemoteProxy`, server lifecycle, and relay
  orchestration.
- `src/proxy/rewrite.js`: `rewriteJsonRpcPayload`,
  `rewriteJsonRpcMessage`, `extractPromptText`, and method-specific rewrite
  handlers.
- `src/proxy/status.js`: route status writes, token usage status updates, and
  proxy status file resolution.
- `src/proxy/trace.js`: client/server trace formatting and safe summaries.
- `src/proxy/ws-frame.js`: `WebSocketConnection`, frame parsing, and frame
  encoding.
- `src/proxy/ws-url.js`: `parseWsUrl` and URL validation.

This phase should not change the runtime protocol. It only creates boundaries
that make future `wss://`, auth, rate limiting, and method-specific middleware
reasonable to add.

### Phase 3: Public API Facade

Add a narrow `src/public-api.js` that represents the future supported import
surface. Keep `src/index.js` unchanged for compatibility during this phase.

Initial facade exports:

- `routePrompt`
- `analyzePrompt`
- `classifyPrompt`
- `loadConfig`
- `readCodexUsage`
- `buildCodexCommand`
- `buildTurnStartRequest`

Documentation can recommend the facade after it exists, but `package.json`
`exports` should wait until the internal splits are complete and import paths
have settled.

### Phase 4: Router Rule Data Model

After CLI and proxy boundaries are stable, start moving router rules toward a
data model. The first step is not to replace the current scoring system. The
first step is to make rule definitions auditable and expand
`test/fixtures/router-eval.json` so behavior changes are intentional.

Target outcome:

- Existing classification behavior remains stable unless a fixture explicitly
  changes.
- Rule additions can be reviewed as data changes where practical.
- `semantic.js` remains an optional classifier hook until there is a concrete
  product reason to add a built-in semantic implementation.

### Phase 5: Open Source and npm Readiness

Release preparation should happen after the engineering boundaries above are
in place.

Likely release-readiness work:

- Decide whether to track `.github/workflows/test.yml` again and remove the
  `.github/workflows/` ignore rule if CI should be part of the public repo.
- Decide whether to track `examples/router-config.json` again and remove the
  `examples/` ignore rule if examples should ship.
- Add `SECURITY.md` with local-tool security scope and disclosure guidance.
- Add `CHANGELOG.md` or release notes discipline.
- Add `exports` and `files` to `package.json` once the public facade is stable.
- Update README and README.zh.md to describe the supported API and install
  expectations without overclaiming release maturity.

## Architecture

The refactor keeps the existing runtime architecture:

```text
prompt -> router -> decision -> transport/proxy -> Codex
```

The change is boundary-focused. CLI parsing, preview construction, proxy
rewriting, WebSocket framing, status persistence, and tracing become separate
units with explicit imports. Each unit should be understandable and testable
without loading the entire executable path.

## Data Flow

CLI flow remains:

1. Parse command-line arguments.
2. Load router configuration.
3. Optionally read Codex usage.
4. Strip prompt effort directives only where the current CLI behavior already
   strips them.
5. Route the prompt.
6. Print the decision and preview.
7. Execute the selected transport only for real execution commands.

Proxy flow remains:

1. Accept a local `ws://` WebSocket client connection.
2. Relay to the real Codex app-server.
3. For client JSON-RPC text payloads, rewrite only supported request methods.
4. For server JSON-RPC text payloads, update status only for supported token
   usage notifications.
5. Relay binary and unsupported payloads without semantic changes.

## Error Handling

- CLI parsing errors should keep the existing `error: <message>` stderr shape.
- Missing required values should keep the current flag-specific messages.
- Proxy URL validation should continue to reject non-`ws://` URLs until a
  separate security design adds `wss://` or auth.
- Status write failures should remain non-fatal and trace-only.
- JSON parse failures in proxy payload rewrite should leave payloads unchanged.
- WebSocket close and error behavior should preserve the current relay cleanup
  behavior.

## Testing Strategy

Each phase must start from the current green test baseline and add focused
tests for the new module boundary.

Phase 1 tests:

- Argument parsing unit tests for main, proxy, and TUI modes.
- Help output tests that preserve command text and status file path rendering.
- Preview tests for exec and app-server transports.
- Existing `test/cli.test.js`, `test/shim.test.js`, and `test/tui.test.js`
  continue to pass.

Phase 2 tests:

- Rewrite unit tests for `turn/start`, prompt effort directives, read-only
  sandbox injection, and `thread/list.cwd` injection.
- Status unit tests for route status and token usage updates.
- WebSocket frame tests for text, binary, continuation, ping, pong, and close
  frames.
- Existing `test/remote-proxy.test.js` continues to pass as an integration
  guard.

Phase 3 tests:

- Public API import smoke test for `src/public-api.js`.
- Compatibility smoke test that `src/index.js` still exports the existing
  tested helpers.

Phase 4 tests:

- Expanded router fixture coverage before any rule behavior changes.
- Fixture diffs are treated as routing policy changes and reviewed as such.

Phase 5 tests:

- Package metadata smoke tests after `exports` and `files` are introduced.
- README command smoke tests for documented dry-run examples.
- CI matrix validation once workflow files are intentionally tracked.

## Compatibility

All existing commands, bin names, prompt effort directives, TUI `#high` aliases,
HUD status shape, and privacy behavior remain compatible through Phases 1 and
2. `src/index.js` remains compatible through Phase 3. Any package-level
breaking change is deferred until the release-readiness phase and must be
documented before it ships.

## Acceptance Criteria

- Phase 1 reduces `src/cli/index.js` to a thin entrypoint and command dispatcher
  while preserving all existing CLI tests and output behavior.
- Phase 2 reduces `src/proxy/remote-proxy.js` to server lifecycle and relay
  orchestration while preserving all proxy integration behavior.
- Phase 3 adds `src/public-api.js` without removing current compatibility
  exports.
- Every completed phase passes `npm test`.
- No phase stores full prompt text in route decisions or HUD status files by
  default.
- No release metadata claims npm readiness until the release-readiness phase is
  deliberately executed.
