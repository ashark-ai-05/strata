# Spike 01: Amp MCP Overlap

**Status:** Harness ready · awaiting `AMP_API_KEY` and Amp MCP config
**Decision:** *(pending data)*

## Question
Should Amp share MCP server access with our app's agent layer, or
should we hide MCP from Amp and inject pre-fetched context?

## Method (when run)
- Configure Amp with a filesystem MCP server pointing at fixtures
- Run 3 prompts in two modes: `mcp-exposed` and `mcp-hidden + injected-context`
- Capture tool calls, result quality, latency, coordination

## Decision criteria

- mcp-exposed clean → **expose-mcp-to-amp** (at work, configure Amp with
  the same MCP servers; let it drive)
- mcp-exposed messy → **hide-mcp-prefetch** (our app fetches via MCP,
  injects results into Amp's prompt; Amp focuses on synthesis only)
- quality varies by source → **mixed** (per-source allowlist for Amp)

## Current status

Harness laid down at `spikes/01-amp-mcp-overlap/`:
- `run.ts` — dual-mode runner
- `README.md` — setup + run instructions

To execute: see `spikes/01-amp-mcp-overlap/README.md`.

## Implications for v1

`AgentExecutor` (Plan 5) shape is parameterized by this decision.
Until the spike runs, we'll build the executor with **mcp-hidden +
prefetch** as the default (more conservative; preserves our control
over retrieval) and add the mcp-exposed path as an opt-in.

## Artifacts

- `spikes/01-amp-mcp-overlap/run.ts`
- `spikes/01-amp-mcp-overlap/README.md`
