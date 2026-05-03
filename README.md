# llm-wiki — LLM Provider Vertical Slice

A config-driven LLM provider layer for the llm-wiki project. This slice proves the architecture end-to-end: a single config file selects which LLM provider to use, and you can swap providers without touching any code.

For the full design intent, see [`docs/superpowers/specs/2026-05-02-llm-wiki-design.md`](docs/superpowers/specs/2026-05-02-llm-wiki-design.md) and its [amendments](docs/superpowers/specs/2026-05-02-llm-wiki-design-amendments.md).

---

## Prerequisites

- **Node.js 24+** — `node --version` should show v24 or later
- **pnpm** — `npm install -g pnpm` if missing
- **Claude Code installed** — required for the OAuth path (claude-agent-sdk provider)
- **Optional API keys** — needed only if you use non-OAuth providers (see `.env.example`)

---

## Install

```bash
pnpm install
```

---

## Configure

The config lives at `~/.llm-wiki/config.json` by default. Running any CLI command will auto-create a starter config on first run.

Override the path via `$LLM_WIKI_CONFIG`:

```bash
LLM_WIKI_CONFIG=/path/to/my/config.json pnpm cli --list-profiles
```

### Example config

```json
{
  "activeProfile": "claude-sdk",
  "profiles": [
    {
      "name": "claude-sdk",
      "llm": { "provider": "claude-agent-sdk" }
    },
    {
      "name": "openai-gpt4o",
      "llm": { "provider": "openai", "model": "gpt-4o" }
    },
    {
      "name": "local-llama",
      "llm": { "provider": "ollama", "model": "llama3.2" }
    },
    {
      "name": "openrouter-sonnet",
      "llm": {
        "provider": "openrouter",
        "model": "anthropic/claude-3-5-sonnet",
        "baseUrl": "https://openrouter.ai/api/v1"
      }
    }
  ]
}
```

---

## Run

### Stream a response

```bash
pnpm cli "What is 2+2?"
pnpm cli --profile openai-gpt4o "Explain async generators in TypeScript"
```

Expected output: the response streams to stdout as it arrives. Usage stats (token counts) print to stderr at the end.

### Health-check a provider

```bash
pnpm cli --probe                        # active profile
pnpm cli --profile local-llama --probe  # specific profile
```

### List profiles

```bash
pnpm cli --list-profiles
```

---

## Available providers

| Provider | Kind | Auth | Notes |
|---|---|---|---|
| `claude-agent-sdk` | agent | OAuth (Claude.ai) **or** `ANTHROPIC_API_KEY` | Recommended home profile. Uses the same engine as Claude Code. No API key needed if you have a Claude.ai Pro/Max subscription. |
| `anthropic-direct` | model | `ANTHROPIC_API_KEY` | Direct Anthropic API with extended thinking. No OAuth (per ToS). |
| `openai` | model | `OPENAI_API_KEY` | OpenAI chat completions. Default model: `gpt-4o`. |
| `openrouter` | model | `OPENROUTER_API_KEY` | OpenAI-compatible routing layer. Configurable model string. |
| `ollama` | model | none | Local models via Ollama. Requires `ollama serve`. Default model: `llama3.2`. |
| `amp` | agent | `AMP_API_KEY` | Sourcegraph Amp — stub, real wiring deferred to spike completion. |

### Setting API keys

Copy `.env.example` to `.env` and fill in the keys you need:

```bash
cp .env.example .env
# edit .env with your keys
```

Then load them before running:

```bash
source .env && pnpm cli "Hello"
# or use dotenv-cli: npx dotenv -e .env pnpm cli "Hello"
```

---

## Tests

```bash
pnpm test          # run all tests once
pnpm test:watch    # watch mode
pnpm typecheck     # TypeScript type check only
```

Tests are unit-only — no live API calls. The `FakeProvider` in `__tests__/provider.test.ts` verifies the interface contract without touching any external service.

---

## What's next

This is the LLM provider vertical slice (Plan 1'). The full Plan 1 (Foundation) adds:

- SQLite storage, embedding pipeline, and chunker
- Space-agent hybrid base
- MCP server integration
- Agent loop (Plan 5): tool-calling wired into model-kind providers
- Amp real wiring (post spike 01+02)

See the [design spec](docs/superpowers/specs/2026-05-02-llm-wiki-design.md) for the full roadmap.

---

## Storage

Local index lives at `~/.llm-wiki/index.sqlite` (single file, WAL mode, sqlite-vec extension loaded). Tables created from `src/storage/migrations/001_initial.sql` cover: `chunks`, `embeddings` (sqlite-vec), `fts` (FTS5), `symbols`, `links`, `prompt_cache`, `result_cache`, `sync_state`.

Inspect status:

```bash
pnpm cli --storage-status
```

The store is created on first invocation; subsequent runs reuse it.

---

## Embedders

Default: bundled ONNX (`bge-small-en-v1.5`, 384-dim). First run downloads ~130MB to the HuggingFace cache (`~/.cache/huggingface/`); subsequent runs are offline.

Available providers (set in `~/.llm-wiki/config.json` under `profiles[].embed`):

| Provider | Auth | Default model | Dims |
| --- | --- | --- | --- |
| `onnx-bundled` | none (offline) | `BAAI/bge-small-en-v1.5` | 384 |
| `openai` | `OPENAI_API_KEY` | `text-embedding-3-small` | 1536 |
| `voyage` | `VOYAGE_API_KEY` | `voyage-3` | 1024 |
| `ollama` | none (local Ollama) | `nomic-embed-text` | 768 |

Test the active embedder:

```bash
pnpm cli --embed "the quick brown fox"
```

Probe both LLM and embed in one command:

```bash
pnpm cli --probe
```

### Cold-start mitigation

The bundled ONNX embedder takes ~4.5s on first call (M-series CPU; spike 03 measurements). Per design amendment 3, future Plan 1.5 will pre-warm the embedder on app launch so users never see this latency interactively.

---

## Running the app

The desktop app is a native Vite + React + tldraw SPA backed by our Hono backend. There are two processes:

- **Backend** on `http://127.0.0.1:3457` — Hono server hosting `/v1/chat`, `/v1/search`, `/v1/health`, etc.
- **Vite dev server** on `http://127.0.0.1:3458` — serves the SPA with HMR. Vite proxies `/v1/*` to the backend so the browser sees a same-origin API.

### Boot both at once

```bash
pnpm dev
```

Starts backend + Vite concurrently via `concurrently`. Ctrl-C terminates both. Open `http://127.0.0.1:3458`.

### Boot individually

```bash
pnpm backend     # backend only on :3457
pnpm app         # Vite only on :3458 (will fail API calls without backend running)
```

### Production build

```bash
pnpm app:build       # outputs to app/dist/
pnpm app:preview     # serves the build for sanity-checking
```

### Historical note

Pre-Plan 5 the app shell was a vendored fork of [agent0ai/space-agent](https://github.com/agent0ai/space-agent) with extensions under `customware/`. That approach was pivoted away from in favour of the native stack above; the vendor + customware infrastructure has been removed. Plans 1.5–1.7 reference the old workflow and are kept for historical record only.

---

## MCP Sources

Configure MCP servers in `~/.llm-wiki/config.json` under `profiles[].sources`. Three transports are supported: `stdio` (subprocess), `sse` (Server-Sent Events), and `http` (Streamable HTTP).

### Example: filesystem MCP

```jsonc
{
  "activeProfile": "claude-sdk",
  "profiles": [
    {
      "name": "claude-sdk",
      "llm": { "provider": "claude-agent-sdk" },
      "embed": { "provider": "onnx-bundled", "model": "BAAI/bge-small-en-v1.5" },
      "sources": [
        {
          "id": "workspace-fs",
          "name": "Workspace Files",
          "transport": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/code"]
        }
      ]
    }
  ]
}
```

### CLI commands

```bash
# List configured sources for the active profile
pnpm cli --list-sources

# Connect every source and print health + tool count
pnpm cli --probe-sources

# Print the tool catalog for one source
pnpm cli --list-tools workspace-fs

# Call a tool directly
pnpm cli --call-tool workspace-fs read_file '{"path": "/Users/me/code/README.md"}'
```

### Roadmap

- v2 (this plan): connect/list/call. Raw tool surface.
- v3 (Plan 3): typed `Capability` verbs (`search` / `fetch` / `list` / `subscribe`) mapped onto MCP tools, with optional `source-manifest.json` hints.
- v3+ (Plan 5): MCP results materialised as typed `Result<K>` and routed through the agent loop.

---

## Running the backend

The backend exposes the LLM provider, embedder, MCP source registry, search, and chat tool-loop over HTTP. The Vite dev server proxies `/v1/*` to it.

### Ports and env

- Default port: `3457`. Override with `LLM_WIKI_BACKEND_PORT=3460 pnpm backend` (don't collide with Vite on `3458`).

### Smoke check

```bash
pnpm backend:check
```

Boots, hits `/v1/health`, exits 0 on success. Used by CI.

### Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/v1/health` | — | `{ ok, profile, llm, embedder }` |
| POST | `/v1/query` | `{ prompt, systemPrompt? }` | SSE stream of provider events |
| POST | `/v1/embed` | `{ texts: [...] }` | `{ embedder, dims, vectors: [...] }` |
| GET | `/v1/sources` | — | `{ sources: [{ id, name, transport }] }` |
| GET | `/v1/sources/probe` | — | `{ ok: [...], failed: [...] }` |
| GET | `/v1/sources/:id/tools` | — | `{ id, name, tools }` |
| POST | `/v1/sources/:id/tools/:tool` | `{ args }` | `{ ok, result }` |

### curl examples

```bash
curl http://127.0.0.1:3457/v1/health

curl http://127.0.0.1:3457/v1/embed \
  -H 'content-type: application/json' \
  -d '{"texts":["hello world"]}'

curl -N http://127.0.0.1:3457/v1/query \
  -H 'content-type: application/json' \
  -d '{"prompt":"What is 2+2?"}'
```

---

## Indexing and search

`pnpm cli --index <path>` walks a directory recursively, chunks every `.md` / `.markdown` / `.txt` file (paragraph-aware, ~500 char target with 50 char overlap), embeds each chunk via the active profile's embedder, and stores everything in `~/.llm-wiki/index.sqlite` (Plan 1's schema).

`pnpm cli --search "<query>"` runs a hybrid search: FTS5 BM25 + sqlite-vec cosine, merged via reciprocal rank fusion (RRF, k=60). Returns the top 10 chunks with body snippets and source URIs.

```bash
# Index a docs directory
pnpm cli --index docs/

# Search the indexed content
pnpm cli --search "config-driven LLM provider"

# Re-index — DocumentIndexer is idempotent. Existing chunks for the
# same (source_id, uri) are replaced; no duplicates.
pnpm cli --index docs/
```

The first index of a directory pays the ONNX embedder cold-start (~4.5s). Subsequent calls in the same process are fast.

### What's indexed today (Plan 3a)

- Plain markdown / text files only. PDF and HTML support arrives in Plan 3b.
- Local filesystem source only. MCP-driven indexing arrives in Plan 3f.
- No cross-source link enrichment; that's Plan 3e.

---

### Code indexing (Plan 3c)

`pnpm cli --index-code <path>` walks `.ts` / `.tsx` / `.js` / `.jsx` files, runs tree-sitter to extract top-level symbols (functions, classes, methods, interfaces, type aliases, arrow-function constants), AST-aware-chunks the source so symbol bodies stay intact, embeds each chunk via the active profile's embedder, and stores everything in `chunks` + `symbols` tables.

```bash
# Index this repo's source
pnpm cli --index-code src/

# List symbols by name
pnpm cli --search-symbols MCPSource
#   class       MCPSource                       /Users/.../src/mcp/source.ts

# Hybrid search across code AND docs (Plan 3a + 3c share the same chunks/embeddings tables)
pnpm cli --search "createMcpClient"
```

**Languages supported in v1:** TypeScript, TSX, JavaScript, JSX (one adapter handles all four — `tree-sitter-typescript` covers the JS subset).

**Adding a language** (Plan 3c.1+): write a new `LanguageAdapter` (~50 LOC) that extracts symbols via tree-sitter, register it in `CodeIndexer.adapterFor()`. Python, Go, Java, Ruby, etc. follow this pattern.

**Symbol storage:** the `symbols` table records `(name, kind, lang, file, refs_json)`. `refs_json` is an array of identifier names referenced from inside that symbol's body — basis for the intra-file call graph (full graph in Plan 3c.4).

---

## Running the app

The native React + Vite UI lives at `app/`. Talks to the Hono backend on `:3457` via a Vite proxy on `:3458`.

### Dev mode

```bash
# Start backend + app together (recommended)
pnpm dev
# → backend on :3457, app on :3458

# Open http://localhost:3458
```

The chat input streams from `/v1/query/openai` (proxied to the backend) using `@ai-sdk/react`'s `useChat` — same OpenAI chat-completions SSE format we already serve.

### Build for production

```bash
pnpm app:build
# → app/dist/

# Preview the built app:
pnpm app:preview
```

In production you can serve `app/dist/` from the backend on `:3457` (single port). That wiring lands in Plan 4b alongside canvas persistence.

### Tests

```bash
# Run all tests (Node + app)
pnpm test

# App tests only
pnpm exec vitest run --config app/vite.config.ts
```

The app's component tests use `@testing-library/react` + `jsdom`. Existing Node-side tests are unchanged.

### Stack

- Vite 6, React 19, TypeScript 5, Tailwind 4
- Vercel AI SDK (`ai` + `@ai-sdk/react`) for chat streaming
- Zustand 5 for app-level state
- lucide-react for icons
- Vitest + @testing-library/react + jsdom for tests

### Canvas (Plan 4b)

The main view splits into an infinite canvas (top) and the chat panel (bottom). Canvas state auto-saves to `localStorage['llm-wiki:canvas:default']` on every change (500ms debounce). Refreshing the page restores the canvas.

To clear the canvas: open DevTools console and run

```js
localStorage.removeItem('llm-wiki:canvas:default')
```

then reload.

#### Custom widgets (extension point)

Each widget is a tldraw [custom shape](https://tldraw.dev/docs/shapes#Custom-shapes) registered in `app/src/canvas/shapes/`. The `Widget` interface from `src/core/widget.ts` (mirrors design spec §3) ties the shape to one or more `ResultKind` values for the future result dispatcher (Plan 4d).

Adding a new widget:

1. Create `app/src/canvas/shapes/<name>.tsx` with a `ShapeUtil` class
2. Add it to the `customShapeUtils` array in `app/src/canvas/Canvas.tsx`
3. (Plan 4d) Map a `ResultKind` to its shape type in the dispatcher

The TextNoteShape (`llm-wiki:text-note`) is the proof-of-wire example — Plan 4c replaces it with a real widget catalog.

### Widget catalog (Plan 4c)

Five built-in widgets ship in v1, mirroring spec §3:

| Shape type | ResultKind(s) accepted | Renders |
| --- | --- | --- |
| `llm-wiki:markdown` | `text-document`, `wiki-page` | GFM markdown via react-markdown |
| `llm-wiki:code-block` | `code-symbol`, `code-file` | Monospace block with file/symbol metadata (no syntax highlighting in v1) |
| `llm-wiki:ticket` | `ticket` | Jira-style card: id + title + status pill + assignee + description |
| `llm-wiki:web-embed` | `web-page` | Sandboxed iframe (`sandbox="allow-scripts"`, no same-origin) |
| `llm-wiki:key-value-card` | (fallback for unmapped kinds) | Title + key/value pairs |

The registry at `src/core/widget-registry.ts` maps every `ResultKind` from spec §3 to a widget. Unmapped kinds fall back to `KeyValueCardWidget`.

#### Debug toolbar

A small debug toolbar in the top-left of the canvas creates one example of each widget per click. Useful for visual smoke testing without driving the full result-dispatcher (Plan 4d).

#### Adding a new widget

1. Create `app/src/canvas/shapes/<name>.tsx` exporting a `ShapeUtil` (use any of the existing widgets as a template — they share `app/src/canvas/shapes/shared.tsx` for the card frame style)
2. Register the `ShapeUtil` in `customShapeUtils` in `app/src/canvas/Canvas.tsx`
3. Add a `Widget` entry in `src/core/widget-registry.ts` mapping the `ResultKind` to the new `shapeType`
4. The dispatcher picks up the new mapping automatically

### Result dispatcher (Plan 4d)

The canvas now has a search overlay in the top-right. Type a query, press Search, and matching chunks from your indexed content materialize as widgets on the canvas (clustered by kind in columns).

Under the hood:
1. `SearchBar` POSTs to `/v1/search` with `{ query, limit }`
2. Backend (`src/backend/routes/search.ts`) wraps `SearchService` from Plan 3a, hydrates each hit's `meta_json`, and returns `{ results: Result[] }` per spec §3
3. `placeResultsOnCanvas(editor, results)` looks up each Result.kind in `WIDGET_REGISTRY` and calls `editor.createShape(...)` with the right shape type and props
4. Layout strategy: simple cluster-by-kind grid (one column per kind, fills downward). Plan 4e adds template-driven layouts (timeline, graph, etc.)

#### Try it

```bash
# Make sure something is indexed first
pnpm cli --index docs/superpowers/
pnpm cli --index-code src/

# Then in the app, search "auth" or "MCPSource" — chunks should land as widgets
```

### Canvas templates (Plan 4e)

Four layouts you can switch between via the "layout" dropdown (top-right of the canvas, beside the SearchBar):

| Template | Layout | Best for |
| --- | --- | --- |
| **Ask anything** (default) | Cluster-by-kind grid — one column per Result.kind | Open-ended questions, "what's around" |
| **Tell me about X** | 5-zone grid: Header / Code (left) / Docs (centre) / Activity (right) / Related (bottom) | Subject deep-dives — see code, docs, and activity around one thing at a glance |
| **What's new since Y** | Lanes per source, x-axis = `fetchedAt` time, oldest left → newest right | Catch-up after time off, recent activity |
| **Trace X everywhere** | Radial — subject card centred, results placed at angles around it | Cross-source references to a name/symbol |

Pick a layout, run a search — results materialize using that layout. Switching templates only affects new placements; existing shapes stay where they are.

#### Adding a template

Each template is a layout function at `app/src/canvas/templates/<id>.ts`:

```typescript
export const layout: TemplateLayout = (results, viewport) => {
  return results.map((r, i) => ({
    shapeType: '...',
    x: ..., y: ...,
    props: shapeProps('...', r, { w: 320, h: 200 }),
  }));
};
```

Register in `app/src/canvas/templates/index.ts`. The TemplatePicker picks it up automatically.

### What's next

Plan 4e closes out the v1 visual surface. Future plans:

- **Plan 5**: Agent loop — chat output triggers searches and dispatches widgets to the active template autonomously
- **Plan 3e**: Cross-source link resolver — turns `JIRA-123`, file paths, k8s names in widget bodies into clickable shape-to-shape links on the canvas
- **Plan 3b**: PDF + HTML in document indexer
- **Plan 3c.1+**: Python / Go / Java / Ruby code adapters
