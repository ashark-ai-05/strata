# Spike 02 — Amp Structured-Output Reliability (harness)

Harness ready. Awaiting `AMP_API_KEY` for execution.

## Run

```bash
export AMP_API_KEY=sgamp_<your-token>   # from https://ampcode.com/settings
cd spikes
npx tsx 02-amp-structured-output/run.ts | tee 02-amp-structured-output/run.log
```

Outputs:
- Live PASS / PASS-RETRY / FAIL per prompt
- Summary line with first-try / retry / fail percentages
- `trials.json` with full per-prompt trial data
- `run.log` mirror of stdout

## What this measures

10 representative prompts sent through `Amp.execute()` with a strict
JSON-only system prompt. Each result is parsed and validated against
`schema.json`. On failure, a stricter retry runs. Final report:

- ≥80% first-try valid → **go-clean** (trust Amp, no parser fallback needed)
- ≥50% first-try valid + retry recovers most → **conditional** (build retry+fallback)
- <50% first-try → **redesign** (agent-mode is fragile; reconsider Mode B)

After running, hand the numbers to whoever is updating
`docs/superpowers/spikes/02-amp-structured-output.md`.
