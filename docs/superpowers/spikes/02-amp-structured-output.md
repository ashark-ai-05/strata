# Spike 02: Amp Structured-Output Reliability

**Status:** Harness ready · awaiting `AMP_API_KEY` for execution
**Decision:** *(pending data)*

## Question
Does Amp reliably emit JSON matching a given schema when instructed to,
making `agent`-mode (Mode B) viable for our agent loop?

## Method (when run)
- 10 representative prompts at varied complexity sent through `Amp.execute()`
  with a strict JSON-only system prompt
- On parse/schema failure, a stricter retry prompt is sent
- Validated with ajv against a simplified ResultEnvelope schema
- Outputs first-try valid %, retry-recovery %, and per-prompt failure modes

## Decision criteria

- ≥80% first-try → **go-clean**: trust Amp output, parse and render
- ≥50% first-try with retry recovering most failures → **conditional**:
  build retry-once + MarkdownWidget fallback path
- <50% first-try → **redesign**: agent-mode is fragile; reconsider Mode B

## Current status

Harness laid down at `spikes/02-amp-structured-output/`:
- `schema.json` — simplified ResultEnvelope
- `prompts.json` — 10 prompts with expected kinds
- `run.ts` — runner with retry logic and ajv validation
- `README.md` — run instructions

To execute: see `spikes/02-amp-structured-output/README.md`.

## Implications for v1

The parse-retry-fallback shape from spec §6.5 is a **defensive default**
until this spike runs. Plan 5 (agent loop) implementation should land
the retry+fallback path regardless; the spike outcome will determine
whether to keep it as load-bearing or simplify.

## Artifacts

- `spikes/02-amp-structured-output/schema.json`
- `spikes/02-amp-structured-output/prompts.json`
- `spikes/02-amp-structured-output/run.ts`
- `spikes/02-amp-structured-output/README.md`
