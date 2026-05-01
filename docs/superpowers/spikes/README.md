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
- **Anthropic auth (two paths):**
  - **Direct API:** API key only. The Feb 2026 ToS bans third-party
    use of subscriber OAuth tokens against the public Anthropic API.
  - **Claude Agent SDK:** `kind: 'agent'` provider via
    `@anthropic-ai/claude-agent-sdk`. The SDK supports OAuth (Claude.ai
    subscriber auth) **or** API key, handled internally. v1 ships
    `ClaudeAgentSdkAdapter` alongside `AmpAdapter` as the second
    agent-mode provider. This is the recommended home profile when
    the user has a Claude Pro/Max subscription.
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

## Spec amendments

All spec amendments live in
[`2026-05-02-llm-wiki-design-amendments.md`](../specs/2026-05-02-llm-wiki-design-amendments.md):

1. **Amendment 1** — Direct-API OAuth removed; OAuth re-enters via
   Claude Agent SDK as a `kind: 'agent'` provider.
2. **Amendment 2** — Space-agent integration is **hybrid** (pinned
   upstream + small patch set), not a hard fork.
3. **Amendment 3** — ONNX cold-start mitigation (pre-warm on launch)
   is **mandatory**, not optional.
4. **Pending** — Amendments 4 and 5 will land when spikes 01 and 02
   execute against a real `AMP_API_KEY`.
