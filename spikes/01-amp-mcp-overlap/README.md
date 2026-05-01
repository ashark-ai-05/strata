# Spike 01 — Amp MCP Overlap (harness)

Harness ready. Awaiting `AMP_API_KEY` and a configured Amp MCP server
for execution.

## Setup (before running)

1. Get an Amp token: https://ampcode.com/settings → `AMP_API_KEY`.
2. Configure Amp with a filesystem MCP server. Edit Amp's config
   (typically `~/.config/amp/config.json` or `~/.amp/config.json`):

   ```json
   {
     "mcpServers": {
       "spike-fs": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/spike-fs-fixture"]
       }
     }
   }
   ```

3. Create the fixture data:

   ```bash
   mkdir -p /tmp/spike-fs-fixture
   echo "this is a fixture file mentioning processPayment" > /tmp/spike-fs-fixture/sample.txt
   echo "another fixture file mentioning OrderProcessor"   > /tmp/spike-fs-fixture/orders.txt
   ```

## Run

```bash
export AMP_API_KEY=sgamp_<your-token>
cd spikes
npx tsx 01-amp-mcp-overlap/run.ts | tee 01-amp-mcp-overlap/run.log
```

The harness runs each of 3 prompts twice — once with MCP available
to Amp (`mcp-exposed`), once with MCP blocked and pre-fetched context
injected (`mcp-hidden`). Stdout shows tool calls and final results.
The full transcript is JSON at the end of the log.

## What this measures

Compare across both modes:
- Did Amp call MCP tools when allowed? Which?
- Result quality with vs. without MCP-tool access?
- Latency / token differences (visible in `system` messages)?

Decision routes:
- `mcp-exposed` works cleanly → **expose-mcp-to-amp** (let Amp drive at work)
- `mcp-exposed` is messy → **hide-mcp-prefetch** (we fetch first, inject context)
- mixed quality → **mixed** (per-source allowlist for Amp exposure)

After running, hand the observations to whoever is updating
`docs/superpowers/spikes/01-amp-mcp-overlap.md`.
