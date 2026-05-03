# Strata

> A local desktop knowledge surface where you ask, and an agent reshapes a canvas of cited widgets to answer.

Strata is a single-user, BYO-credentials app. The agent searches your indexed knowledge (docs, code, prior conversations) and the public web, places typed widgets on a tldraw canvas (markdown / code-block / table / timeline / file-tree / etc.), and streams a short reply pointing to what it built. Every conversation indexes back into the same store so search compounds with use.

It's also a multi-agent stage: `/team <prompt>` spins up a Researcher → Builder → Critic pipeline, each handing off explicitly to the next, all building on the same canvas.

```
┌──────────────────────────────────────────────────────────────────┐
│  🔬 Researcher   ✓  ──→  🛠 Builder   ●●●  ──→  🔍 Critic   ○    │
│                                                                   │
│  → Builder: lead with applyToolDirective as the agent→canvas     │
│    seam; the place branch is the most interesting bit            │
└──────────────────────────────────────────────────────────────────┘
                                 ↓
                    [canvas: 4 widgets placed]
```

---

## What's interesting about it

- **Self-improving KB** — every conversation auto-indexes into the same SQLite store as your docs/code; `search_kb` finds prior chats. The system gets smarter as you use it.
- **Multi-agent `/team`** — three agents pass a baton: Researcher gathers evidence, Builder synthesizes, Critic flags gaps. Each phase sees the cumulative canvas the prior phases built. Live-rendered handoff cards make the chemistry visible.
- **Native canvas, not chat-text** — answers materialize as 8 typed widgets (`markdown`, `code-block`, `ticket`, `web-embed`, `key-value-card`, `table`, `timeline`, `file-tree`). All collapsible, resizable, role-tinted, draggable. Hover for actions (copy / open URL / delete).
- **MCP-native** — any MCP server in your config (filesystem, Confluence, Jira, ...) gets exposed to the agent automatically. Tool schemas eagerly loaded so the SDK doesn't burn turns on `ToolSearch`.
- **Conversation history with per-thread canvas** — each conversation has its own tldraw canvas. Switch threads via the History panel; both canvas + chat swap atomically.
- **Web search via Tavily** — when the topic isn't in your KB, the agent reaches for `web_search` and places `web-embed` cards with click-through URLs.
- **Sources panel** — visualize what's indexed: code, docs, conversations, MCP, with chunk counts and last-indexed timestamps.

---

## Quick start

```bash
pnpm install                    # one-time
pnpm cli --probe                # health-check provider + embedder
pnpm cli --index ./docs         # index something so search_kb has hits
pnpm dev                        # backend on :3457, app on :3458
```

Open <http://localhost:3458> and ask Strata anything.

### LLM auth

Default profile uses `@anthropic-ai/claude-agent-sdk` with **OAuth via your Claude.ai login** — no API key needed if you already use Claude Code. Otherwise set `ANTHROPIC_API_KEY` in `.env`.

Other providers (OpenAI, OpenRouter, Ollama, Anthropic direct, Sourcegraph Amp) are available via config; see `.env.example` for the keys.

### Web search

Set `TAVILY_API_KEY` in `.env` (free tier: 1000 searches/month at <https://app.tavily.com>). Without it, `web_search` returns an explicit "not configured" error instead of silently failing.

### MCP sources

Add servers under `profiles[].sources` in `~/.strata/config.json`:

```jsonc
{
  "activeProfile": "claude-sdk",
  "profiles": [{
    "name": "claude-sdk",
    "llm": { "provider": "claude-agent-sdk" },
    "sources": [{
      "id": "dev-filesystem",
      "name": "Development directory",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Development"]
    }]
  }]
}
```

Verify with `pnpm cli --probe-sources`. Then chat — the agent calls them as `mcp__dev-filesystem__<tool>`.

> ⚠️ The Claude Agent SDK announces its `cwd` to spawned MCP servers as a "root", which **overrides** allowed-paths args. The effective filesystem-MCP scope is whatever directory `pnpm backend` ran from. Run from the parent directory you want indexed, or use `--index-code` to pull content into the SQLite KB instead.

---

## Slash commands

Type `/` in chat to see the popover.

| Command | Effect |
| --- | --- |
| `/team <prompt>` | Run the Researcher → Builder → Critic pipeline |
| `/clear` | Start a new conversation (current one stays in History) |
| `/template <id>` | Switch active canvas template (`ask-anything`, `tell-me-about-x`, `whats-new-since-y`, `trace-x-everywhere`) |
| `/help` | Show all commands as a toast |

---

## Architecture

```
┌────────────────────────┐                ┌─────────────────────────┐
│  Vite + React + tldraw │   /v1/chat     │  Hono backend           │
│  app on :3458          │ ─────────────→ │  (provider abstraction) │
│                        │   /v1/team     │                         │
│  • Chat (useChat)      │ ─────────────→ │  ClaudeAgentSdkAdapter  │
│  • tldraw canvas       │                │       │                 │
│  • Conversations       │                │       ▼                 │
│  • Sources panel       │                │  Claude Agent SDK       │
│  • Team pipeline       │ ←─── UIMS ──── │  (in-process MCP)       │
│                        │                │       │                 │
└────────────────────────┘                │       ▼                 │
                                          │  10 strata tools        │
                                          │  + external MCP servers │
                                          │       │                 │
                                          │       ▼                 │
                                          │  SQLite + sqlite-vec    │
                                          │  (chunks + embeddings)  │
                                          └─────────────────────────┘
```

**Backend** (`src/`): Hono routes — `/v1/chat`, `/v1/team`, `/v1/search`, `/v1/index-conversation`, `/v1/sources/list`, `/v1/health`. Provider abstraction (`LLMProvider` interface) supports Claude Agent SDK, OpenAI, OpenRouter, Ollama, Anthropic direct, Sourcegraph Amp. `SearchService` queries SQLite via FTS5 + sqlite-vec, returns ranked hits.

**Frontend** (`app/src/`): tldraw 3 with custom shape utils for each widget kind. Zustand stores for conversations, templates, canvas stats, chat actions. AI SDK 6 `useChat` for chat streaming; UIMS protocol carries text, tool events, and custom data parts (`data-team-phase`, `data-team-handoff`).

**Tool surface**: 10 in-process MCP tools the agent calls — `search_kb`, `fetch_result`, `web_search`, `place_widget`, `read_canvas`, `read_widget`, `focus_widget`, `link_widgets`, `clear_canvas`, `switch_template`. External MCP servers add their own (`mcp__<source-id>__<tool>`).

---

## Indexing

Two CLI commands populate the SQLite KB:

```bash
pnpm cli --index ./docs         # markdown / text → chunked + embedded
pnpm cli --index-code ./src     # .ts/.tsx/.js/.jsx → tree-sitter chunks + symbols
```

Idempotent — re-indexing replaces prior chunks for the same source. Conversations auto-index after every assistant turn, no command needed.

`pnpm cli --search "<query>"` runs a hybrid BM25 + vector search across everything indexed.

`pnpm cli --storage-status` shows index size + table row counts.

---

## Project layout

```
src/                           backend (Node)
  agent/                       agent-loop tool surface
    tools/                     10 MCP tools (search_kb, place_widget, …)
    payloads.ts                Zod schemas per widget kind
  backend/
    routes/                    chat, team, search, index-conversation, sources-list
    state.ts                   BackendState — providers, embedders, MCP registry
  config/                      ~/.strata/config.json loader + zod schema
  embedders/                   ONNX bundled, OpenAI, Voyage, Ollama
  indexer/                     document + code indexers
  mcp/                         MCP transport + source registry
  providers/                   LLMProvider implementations
  search/                      SearchService (FTS5 + sqlite-vec hybrid)
  storage/                     SQLite open + migrations
  web/                         Tavily web search client

app/                           frontend (Vite + React + tldraw)
  src/
    canvas/                    tldraw setup + 8 custom shape utils
    components/                Chat, ConversationsSidebar, SourcesPanel, …
    state/                     zustand stores

docs/superpowers/              design specs + execution plans (historical)
```

---

## Tests

```bash
pnpm test                                          # backend (vitest)
pnpm exec vitest run --config app/vite.config.ts   # frontend (vitest + jsdom)
pnpm typecheck                                     # tsc --noEmit (root)
pnpm exec tsc --noEmit -p app/tsconfig.json        # tsc (app)
```

108 frontend + 203 backend tests at last commit.

---

## Status

Experimental. Single-user, BYO credentials, runs entirely on your machine (the only network calls are to your chosen LLM provider, the embedder if you use OpenAI/Voyage, Tavily for web search, and any MCP servers you configure).

The code under `docs/superpowers/` was the design + planning record — historical, not load-bearing for usage.
