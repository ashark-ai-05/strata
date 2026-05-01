# Pre-v1 Spikes — Index

Five investigations completed before any v1 production code is written.
Each spike produces a binding decision for Plan 1 (Foundation).

## Status

| # | Spike                                    | Status      | Decision    |
|---|------------------------------------------|-------------|-------------|
| 1 | Amp MCP overlap                          | harness ready | pending data |
| 2 | Amp structured-output reliability        | harness ready | pending data |
| 3 | Bundled ONNX viability                   | complete    | go          |
| 4 | Anthropic OAuth public availability      | complete    | no-go       |
| 5 | Space-agent fork strategy                | complete    | hybrid      |

**Spikes 1 and 2** have working harnesses checked in; running them
requires an `AMP_API_KEY`. Set the key, follow the per-spike README,
and update the findings docs with the measured numbers. Plans 1–4
do not depend on these outcomes.

## Spike findings

- [01 — Amp MCP overlap](./01-amp-mcp-overlap.md) *(harness ready)*
- [02 — Amp structured-output](./02-amp-structured-output.md) *(harness ready)*
- [03 — Bundled ONNX viability](./03-onnx-bundled.md)
- [04 — Anthropic OAuth availability](./04-anthropic-oauth.md)
- [05 — Space-agent fork strategy](./05-space-agent-fork.md)

## Plan 1 implications (from completed spikes)

Synthesizing spikes 03, 04, and 05:

- **Embedder default:** `onnx-bundled` (`bge-small-en-v1.5`, 127 MB,
  384-dim, 272 chunks/sec, 4.5s cold-start). Pre-warm on app launch to
  mask cold-start. Sized for the binary; offline load works.
- **Anthropic auth:** API key only in v1. The provider config schema
  for Anthropic supports `auth.type = 'apiKey'` exclusively. **Drop
  OAuth entirely from v1 plans** — Anthropic's Feb 2026 ToS now
  explicitly bans third-party use of subscriber OAuth tokens. Revisit
  only if Anthropic opens a public client-registration program; do not
  build for it speculatively.
- **Space-agent integration:** **hybrid** — pin a known-good upstream
  commit and maintain a small patch set. Of 10 required v1 changes:
  3 are pure extensions, 5 are extension+wiring (no core edits, but
  need module/endpoint registration), and 2 require core edits in
  `server/jobs/job_runner.js` (zero churn upstream, low merge friction).
  Plan 1 should start with `git clone` of space-agent at a pinned SHA,
  then a thin patch-tracking layer rather than a hard fork.
- **Agent-mode (Mode B / Amp):** decision still pending spikes 01 and 02.
  Plan 5 will not start until those land. The `LLMProvider.kind = 'agent'`
  abstraction stays in the design as planned — only the *contents* of the
  AgentExecutor implementation are deferred.

## Spec amendment

`docs/superpowers/specs/2026-05-02-llm-wiki-design.md` says:

> Anthropic (API key today; OAuth when publicly available)

Per spike 04, replace with:

> Anthropic (API key only). OAuth is not available to third-party apps;
> Anthropic's Feb 2026 ToS update bans third-party use of subscriber
> OAuth tokens. No v1.x roadmap for this unless Anthropic opens a public
> client-registration program.

This amendment is captured in `2026-05-02-llm-wiki-design-amendments.md`.
