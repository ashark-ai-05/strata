# LLM-Wiki — Design Spec

**Date:** 2026-05-02
**Status:** Draft, pre-implementation
**Audience:** Author + future implementer (human or AI agent)
**Use:** This document doubles as the design spec and as the foundational
prompt for implementation planning.

---

## 1. Vision and v1 scope

### One-line vision

A local desktop app that lets a user query and reason across any
MCP-accessible source — code, docs, tickets, logs, runtime — and materializes
the answer as a canvas of cited, navigable widgets. Built on a forked
[space-agent](https://github.com/agent0ai/space-agent) runtime. Generic
platform; persona/domain curation ships as installable skill packs.

### Why this exists

Engineering organizations carry knowledge across many systems: codebases,
Confluence, Jira, ELK, Kubernetes, dashboards, runbooks, chat. Existing search
tools surface rows of links. Existing chat tools answer questions but lose the
visual + spatial structure people use to reason about systems. The unique
opportunity is **cross-source synthesis rendered as a canvas of widgets** —
widgets that link to each other, can be drilled into, and persist as durable
artifacts of investigations.

### v1 ships

- Forked space-agent runtime
- Generic MCP adapter — any MCP server becomes a typed `Source` with
  `{ search, fetch, list, subscribe }` capabilities
- Local index layer for fetch-only sources (codebase + documents)
- Provider-agnostic LLM layer with config-driven selector:
  - Amp (`@sourcegraph/amp-sdk`) — agent mode
  - Anthropic (API key today; OAuth when publicly available)
  - OpenAI (API key)
  - OpenAI-compatible endpoints (Vercel AI Gateway, Together, Groq, etc.)
  - Ollama (local model)
- Result-shape registry + 14 built-in generic widgets
- 4 generic canvas templates: *AskAnything*, *TellMeAboutX*,
  *WhatsNewSinceY*, *TraceXEverywhere*
- Cross-source link resolver
- SQLite + sqlite-vec + FTS5 index, single file, per user
- Bundled ONNX embedder (`bge-small-en-v1.5`) by default; cloud / Ollama
  embedders as opt-in upgrades
- Prompt-cache, result-cache, embedding-cache (all SQLite)
- Saved canvases as markdown bundles — these *are* the wiki

### v1 explicitly does NOT include

- Persona seed packs (v1.5; Developer-flavored pack is the first add-on)
- LLM-emitted ad-hoc widgets — built-in widget set covers v1
- Cross-repo code-graph analysis
- Write-back to any source — v1 is read-only across the board
- Multi-user sync / sharing — saved canvases can be checked into git
- Hosted / SaaS deployment — local desktop only
- Realtime collaboration

### v1 demo story

Open the app → activate a profile → app starts background indexing while
already-live sources work immediately → type a question → canvas materializes
with cited widgets across all configured sources → click any widget to drill
deeper → save the canvas → reopen tomorrow, instant replay from markdown.
Switch profile (`work` → `home-claude`) → re-run the same query, see how
LLM choice affects synthesis quality.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  UI layer (forked space-agent)                                  │
│  Infinite canvas · widget runtime · skill/SKILL.md system ·    │
│  canvas persistence (markdown + git) · MCP config UI            │
├─────────────────────────────────────────────────────────────────┤
│  Agent loop                                                     │
│  intent classifier → skill match → retrieval planner →         │
│  multi-source fan-out → result normalization → widget dispatch  │
│  → canvas layout                                                │
├─────────────────────────────────────────────────────────────────┤
│  Core abstractions                                              │
│  Source · Capability · Result(shape+provenance+freshness) ·     │
│  Widget(shape contract) · Skill(canvas template + recipe)       │
├─────────────────────────────────────────────────────────────────┤
│  Index + cache layer (SQLite single-file, per-user)             │
│  codebase: tree-sitter symbols + chunk embeddings + BM25        │
│  documents: chunk embeddings + BM25 (PDF, HTML, MD, wiki)       │
│  tickets:   structured field embed + BM25                       │
│  prompt cache · result cache · embedding cache                  │
│  cross-source link resolver                                     │
├─────────────────────────────────────────────────────────────────┤
│  LLM + embedding provider abstraction                           │
│  LLMProvider = { kind: 'model' | 'agent' }                      │
│  EmbeddingProvider (ONNX bundled · OpenAI · Voyage · Ollama)    │
├─────────────────────────────────────────────────────────────────┤
│  MCP transport (stdio / SSE / HTTP)                             │
│  generic adapter — any user-configured MCP server becomes a     │
│  Source with introspected Capabilities                          │
└─────────────────────────────────────────────────────────────────┘
```

### Key flow (single query)

1. User types question into canvas chat.
2. Query enrichment resolves inline references (`@file`, `JIRA-NNN`, "this widget").
3. Intent classifier picks one of: `lookup`, `synthesize`, `investigate`,
   `render-widget`, `navigate-source`.
4. Skill matcher selects a skill (or default-per-intent).
5. Cache check — hit returns instantly.
6. Provider branch:
   - `model`-mode: retrieval planner emits a step DAG; agent loop runs
     tool-calling against MCP capabilities.
   - `agent`-mode (Amp): build a task envelope; `execute()` Amp; parse
     structured `result` message into typed Results.
7. Cross-source link resolver enriches Results.
8. Widget dispatcher picks renderers per kind; layout per template/cluster.
9. Stream widgets to canvas (skeleton → loaded). Auto-save markdown bundle.

---

## 3. Core abstractions

These schemas are load-bearing. The "generic" property of the platform comes
from disciplined adherence to these contracts.

### `Source`

Any MCP server, configured by the user, introspected on connect.

```ts
type Source = {
  id: string                    // 'github-monorepo', 'confluence-eng', ...
  name: string
  transport: 'stdio' | 'sse' | 'http'
  config: Record<string, unknown>
  capabilities: Capability[]    // discovered + optionally hinted
  health: 'connected' | 'degraded' | 'disconnected'
  hints?: SourceManifest        // optional: maps MCP tools → verbs
}
```

The adapter introspects the MCP server's tools at connect time. If a server
uses non-standard tool names, a small `source-manifest.json` provides hints.

### `Capability`

A small, fixed verb set. Resist adding more.

```ts
type Capability =
  | { verb: 'search';    kinds: ResultKind[]; filters?: FilterSpec }
  | { verb: 'fetch';     kinds: ResultKind[] }
  | { verb: 'list';      kinds: ResultKind[] }
  | { verb: 'subscribe'; kinds: ResultKind[] }
```

`compute` and `query` are special cases of `search` with structured filters.
Do not add them in v1.

### `Result`

Every retrieved item flows through this. Widgets dispatch by `kind`.
Cross-source linking attaches via `links`.

```ts
type Result<K extends ResultKind = ResultKind> = {
  id: string
  sourceId: string
  kind: K
  shape: ShapeOf<K>
  provenance: {
    uri: string                 // canonical re-fetch URL
    fetchedAt: number
    via: { capability: Verb; query: unknown }
  }
  freshness: {
    ttlMs?: number
    liveStream?: boolean
  }
  links: ResultLink[]
}
```

### `ResultKind` — fifteen kinds in v1

```ts
type ResultKind =
  | 'text-document'             // generic markdown / HTML / PDF page
  | 'wiki-page'                 // Confluence-like (rich)
  | 'code-file'                 // file w/ language + path
  | 'code-symbol'               // function / class / method
  | 'code-diff'                 // PR / commit
  | 'ticket'                    // Jira-like
  | 'log-stream'                // ELK
  | 'k8s-resource'              // Pod / Deployment / Service / ...
  | 'web-page'                  // generic web result
  | 'image'
  | 'table-row-set'             // tabular
  | 'metric-series'             // time-series
  | 'chat-message'              // Slack / Teams
  | 'runbook'                   // structured procedure
  | 'dashboard-embed'           // sandboxed iframe
```

Adding a new source / data type later = define a new kind + register a
widget. No agent-loop code changes.

### `Widget` — fourteen built-in widgets in v1

```ts
type Widget = {
  id: string
  acceptsKinds: ResultKind[]
  render: (results: Result[], ctx: RenderCtx) => CanvasFragment
  refresh?: (results: Result[]) => Promise<Result[]>
  actions?: WidgetAction[]      // 'open-in-source' | 'expand' | 'pin' | 'cite'
}
```

| Widget                  | Accepts                                    |
|-------------------------|--------------------------------------------|
| `MarkdownWidget`        | `text-document`, `wiki-page` (basic)       |
| `WikiPageWidget`        | `wiki-page` (rich, with TOC)               |
| `CodeBlockWidget`       | `code-symbol`, `code-file`                 |
| `CodeDiffWidget`        | `code-diff`                                |
| `TicketCardWidget`      | `ticket`                                   |
| `LogTimelineWidget`     | `log-stream` (live-tail capable)           |
| `K8sResourceWidget`     | `k8s-resource`                             |
| `WebEmbedWidget`        | `web-page` (sandboxed iframe)              |
| `TableWidget`           | `table-row-set`                            |
| `KeyValueCardWidget`    | fallback for unrecognized shapes           |
| `MetricChartWidget`     | `metric-series` (sparkline + range)        |
| `ChatMessageWidget`     | `chat-message` (threaded)                  |
| `RunbookWidget`         | `runbook` (steps; **read-only render**)    |
| `DashboardEmbedWidget`  | `dashboard-embed` (allowlisted origins)    |

### `Skill`

The unit of curation. SKILL.md style (matches space-agent's pattern) plus
structured frontmatter for routing.

```ts
type Skill = {
  id: string
  name: string
  description: string
  triggers: SkillTrigger[]
  prompt: string                // markdown — the agent recipe
  canvasTemplate?: CanvasTemplateRef
  customWidgets?: WidgetRef[]
  requiredSources?: SourceKind[]
}

type CanvasTemplate = {
  id: string
  layout: 'free' | 'grid' | 'timeline' | 'graph'
  zones: CanvasZone[]
}
```

### `ResultEnvelope` — agent-mode contract

The JSON envelope that `agent`-kind providers (Amp) must return:

```ts
type ResultEnvelope = {
  results: Result[]
  layoutHints?: { zone?: string; size?: 'sm' | 'md' | 'lg' }[]
  narrative?: string            // optional natural-language synthesis
  diagnostics?: { sourceId: string; status: string }[]
}
```

If parsing fails twice, fall through to free-text rendering inside a
`MarkdownWidget`. Degraded but never broken.

---

## 4. Indexing and cache layer

### What to index vs. fetch live

| Source kind          | Strategy                               | Reason                            |
|----------------------|----------------------------------------|-----------------------------------|
| Codebase             | **Index** (full + incremental git diff)| Too large for per-query MCP walk  |
| Wiki / Confluence    | **Index** (full + nightly delta)       | Search needs semantic + BM25      |
| Tickets / Jira       | **Index** + live fetch on render       | Search benefits from index        |
| Documents / PDF      | **Index**                              | Extraction is expensive           |
| Web pages (saved)    | **Index**                              | User-bookmarked refs              |
| ELK logs             | **Live only**, 60s cache               | Volume + freshness                |
| K8s state            | **Live only**                          | Inherently real-time              |
| Metrics              | **Live only**                          | Time-series storage isn't ours    |
| Chat (Slack/Teams)   | **Index recent (30d)** + live          | Recency-driven                    |

### Storage layout (per user)

```
~/.<app>/
├─ index.sqlite           ← all indexes + caches in one file
├─ canvases/<id>/         ← saved canvases as markdown bundles
├─ skills/                ← installed SKILL.md packs
└─ config.json            ← profiles
```

### `index.sqlite` schemas

```sql
chunks         (id, source_id, kind, body, meta_json, embedder_id)
embeddings     (chunk_id, vec)            -- sqlite-vec virtual table
fts            FTS5 virtual table on chunks.body
symbols        (id, source_id, file, name, kind, lang, refs_json)
links          (from_chunk_id, to_uri, link_type, confidence)
prompt_cache   (key, response, tokens_in, tokens_out, created_at, ttl_ms,
                profile_id)
result_cache   (uri, kind, shape_json, fetched_at, ttl_ms)
sync_state     (source_id, last_synced_at, cursor)
```

`embedder_id` on `chunks` enables clean re-indexing when the embedder is
swapped between profiles.

### Indexer architecture

```
Index Orchestrator
├─ Scheduler (per Source: full | incremental | TTL-driven)
├─ Indexers (one per shape)
│  ├─ CodeIndexer      — tree-sitter symbols + AST-chunked embeddings + FTS
│  ├─ DocumentIndexer  — PDF (Marker) / HTML / MD → chunked embeddings + FTS
│  └─ TicketIndexer    — structured field embed (title+desc+comments) + FTS
└─ Progress reporter   — surfaces to UI as a live canvas widget
```

**Code indexing scope (v1):** tree-sitter symbol extraction (functions,
classes, methods, imports) + AST-aware chunking (no mid-function splits) +
intra-file call refs. Cross-repo / cross-file call graph is v2 — too large a
scope multiplier for v1.

### Cross-source link resolver

```
ResolveLinks(text) →
  1. Regex pass    — JIRA-\d+, file paths, URLs, k8s names, commit SHAs
  2. Index lookup  — symbols.byName, chunks.byUri, source.fetch(uri)
  3. Fuzzy pass    — embed similarity for "the checkout service"
                     (only when intent calls for it; expensive)
```

Each link carries a confidence score. Below threshold → hidden from UI,
logged for tuning. This is what makes the canvas feel alive without per-
render LLM calls.

### Cache strategy

| Cache             | Key                                                    | TTL                                      |
|-------------------|--------------------------------------------------------|------------------------------------------|
| `prompt_cache`    | `sha256(profile + skill + query + ctxHash)`           | 1d `lookup`, 1h `investigate`, 0 live    |
| `result_cache`    | `uri`                                                  | from `Result.freshness.ttlMs`            |
| `embedding_cache` | chunk content hash                                     | infinite                                 |

Target: **30%+ prompt-cache hit rate** under typical use.

### Initial-sync UX (the make-or-break onboarding moment)

1. Connect MCP servers — seconds. Live sources work immediately.
2. Background indexers start; progress is a pinned canvas widget.
3. Progressive availability — search lights up per-source as chunks complete.
4. **No blank screen, ever.** Minute one feels useful even at 0.5% indexed.

---

## 5. LLM + embedding provider layer

### Two environments, one design

|                    | **Work** (constrained)        | **Home** (permissive) |
|--------------------|-------------------------------|------------------------|
| LLM access         | Amp SDK only                  | Any                    |
| External APIs      | Blocked / unknown             | Open                   |
| Local models       | Probably not allowed          | Yes                    |
| MCP servers        | Internal network              | Wherever               |

**Design rule:** the default config must run with *only* Amp + bundled ONNX
embedder + local SQLite. Everything else is an opt-in upgrade.

### LLM provider abstraction

```ts
type LLMProvider =
  | { kind: 'model'; generate(req): AsyncIterable<TextDelta | ToolCall> }
  | { kind: 'agent'; execute(task): AsyncIterable<AgentMessage> }
```

| Adapter                | Kind    | Auth                                       | Notes                                       |
|------------------------|---------|--------------------------------------------|---------------------------------------------|
| `AmpAdapter`           | `agent` | `AMP_API_KEY` env var                      | `@sourcegraph/amp-sdk`; agent owns its loop |
| `AnthropicOAuthAdapter`| `model` | OAuth via system browser; tokens in keychain | If/when publicly available                |
| `AnthropicKeyAdapter`  | `model` | `ANTHROPIC_API_KEY`                        | `@ai-sdk/anthropic`                         |
| `OpenAIAdapter`        | `model` | `OPENAI_API_KEY`                           | `@ai-sdk/openai`                            |
| `OpenAICompatAdapter`  | `model` | URL + key                                  | AI Gateway, Together, Groq, vLLM, etc.      |
| `OllamaAdapter`        | `model` | none                                       | `@ai-sdk/ollama`                            |

**Important:** Amp SDK is **agent-mode only** — `execute()` returns an async
iterable of structured messages (`system`, `assistant`, `result`). It is not
a chat-completions passthrough. Our agent loop must accept this shape.

### Embedding provider abstraction

```ts
type EmbeddingProvider = {
  id: string
  embed(texts: string[]): Promise<Float32Array[]>
  dims: number
  capabilities: { batchSize: number; offline: boolean }
}
```

**Default: bundled ONNX.** Ship the model file inside the app binary —
no download on first launch, works on locked-down networks.

| Embedder                                | Size   | Dims | Notes                              |
|-----------------------------------------|--------|------|-------------------------------------|
| **`bge-small-en-v1.5` (bundled ONNX)**  | ~130MB | 384  | Default; via `onnxruntime-node`     |
| Ollama `nomic-embed-text`               | local  | 768  | Optional upgrade (home)             |
| OpenAI `text-embedding-3-small`         | cloud  | 1536 | Optional upgrade (home)             |
| Voyage `voyage-3`                       | cloud  | 1024 | Code-tuned (home)                   |

Indexes are tagged with `embedder_id`; swapping the embedder triggers
re-indexing with explicit user consent and progress UI.

### Configuration (profiles)

```jsonc
// ~/.<app>/config.json
{
  "activeProfile": "work",
  "profiles": {
    "work": {
      "llm":   { "provider": "amp" },
      "embed": { "provider": "onnx-bundled" },
      "sources": [ /* work MCP servers */ ]
    },
    "home-claude": {
      "llm":   { "provider": "anthropic", "model": "claude-opus-4-7",
                 "auth": { "type": "oauth", "store": "keychain" } },
      "embed": { "provider": "openai", "model": "text-embedding-3-small",
                 "auth": { "type": "apiKey", "envVar": "OPENAI_API_KEY" } },
      "sources": [ /* home MCP servers */ ]
    },
    "home-local": {
      "llm":   { "provider": "ollama", "model": "llama3.3" },
      "embed": { "provider": "ollama", "model": "nomic-embed-text" },
      "sources": [ /* same or different */ ]
    }
  }
}
```

### Profile-activation probe

On profile activation:

1. **LLM probe** — minimal generate/execute call; check auth, latency, capabilities.
2. **Embedder probe** — embed a test string; verify `dims` matches index expectations.
3. **MCP probe** — connect each Source; introspect Capabilities.
4. Render a **Profile Health** widget on the canvas with pass/fail/warn per check.

If `embed.dims` differs from indexed embeddings, surface a "Re-index needed"
banner with explicit user action; never silently degrade.

---

## 6. Agent loop / query flow

```
┌───────────────────────────────────────────────────────────────────┐
│  Query enters: text + canvas context + active widget refs         │
├───────────────────────────────────────────────────────────────────┤
│  1. Enrichment    resolve @file, JIRA-NNN, "this widget"          │
│  2. Intent        rules first, LLM fallback (5 intents)           │
│  3. Skill match   triggers → skill + canvas template, or default  │
│  4. Cache check   hit → skip to 8                                 │
├───────────────────────────────────────────────────────────────────┤
│  5. Provider branch                                               │
│                                                                   │
│   kind=model                   kind=agent (Amp)                   │
│   ──────────                   ───────────                        │
│   plan retrieval (LLM →        build task envelope:               │
│   JSON DAG of MCP calls)       skill prompt + canvas context +    │
│                                JSON output schema                 │
│                                                                   │
│   execute DAG: tool loop       Amp.execute(task) — stream         │
│   with MCP capabilities                                           │
│   as tools                     parse `result` JSON → Result[]     │
│                                (1 retry on schema fail)           │
├───────────────────────────────────────────────────────────────────┤
│  6. Enrichment    cross-source link resolver · dedup · provenance │
│  7. Dispatch      widget per kind · layout per template/cluster   │
│  8. Stream        skeleton → loaded · persist to canvas markdown  │
└───────────────────────────────────────────────────────────────────┘
```

### Stage details

**1 — Query enrichment.** Catch refs before they reach the LLM:
- `@path/to/file.ts` → `code-file` ref
- `JIRA-123` → `ticket` ref
- `kind/name` (k8s shorthand) → `k8s-resource` ref
- `"this widget"` / canvas-pinned items → `Result[]` from canvas state

Cheap, deterministic, saves an LLM round-trip.

**2 — Intent classification.** Five intents:

| Intent             | Trigger heuristic                           | Default skill           |
|--------------------|---------------------------------------------|-------------------------|
| `lookup`           | "what is", "show me", explicit ref          | `default-lookup`        |
| `synthesize`       | "tell me about", "summarize", "explain"     | `default-synthesize`    |
| `investigate`      | "why", "what changed", "what broke"         | `default-investigate`   |
| `render-widget`    | "draw", "chart", "kanban of", "timeline of" | `default-render`        |
| `navigate-source`  | imperative on a known ref                   | `default-navigate`      |

Rule-based first; LLM fallback if confidence < 0.7. In `agent` mode with no
secondary model available, intent classification folds into the Amp prompt.

**3 — Skill match.** First-match-wins over installed skills' triggers; default
skills always match as fallback. A skill brings: prompt template, canvas
template, custom widgets to register, required Sources (skill is skipped if
required Sources are unmet).

**4 — Cache check.** Key includes `profileId`, `skill.id`, normalized query,
context hash. Per-intent TTL. Cache stores `(Result[], layoutDirective)` so
replaying a cached query rebuilds the canvas instantly.

**5 — Provider branch.** Two implementations of one interface:

```ts
interface QueryExecutor {
  run(ctx: QueryContext): AsyncIterable<ProgressEvent | Result>
}
```

`ModelExecutor` (model-kind providers):

```ts
const plan = await llm.generateObject({
  schema: RetrievalPlanSchema,
  system: skill.prompt,
  prompt: ctx.query,
  context: ctx.refs
})

const tools = sources.flatMap(s => s.capabilities.map(toTool))
for await (const event of llm.streamWithTools({ tools, plan, ... })) {
  yield event
}
```

`AgentExecutor` (Amp):

```ts
const taskEnvelope = renderTaskTemplate({
  systemContext: skill.prompt,
  query: ctx.query,
  refs: ctx.refs,
  outputSchema: ResultEnvelopeSchema,
  layoutHints: skill.canvasTemplate
})

for await (const msg of execute({ prompt: taskEnvelope })) {
  if (msg.type === 'assistant') yield asProgressEvent(msg)
  if (msg.type === 'result')    yield* parseEnvelope(msg.result)
}
```

`parseEnvelope` validates against `ResultEnvelopeSchema` and retries once
with a stricter prompt on failure. After two failures, fall through to
free-text rendering inside `MarkdownWidget`.

**6 — Enrichment.** Cross-source link resolver runs over Result bodies; adds
`links: ResultLink[]`. Dedupes by `provenance.uri` or content hash. Stamps
freshness.

**7 — Dispatch + layout.**

```ts
const widgets = results.map(r => ({
  widget: registry.pickByKind(r.kind),
  result: r,
  zone:    template?.assignZone(r) ?? clusterByKind(r)
}))
```

Layout strategies (v1):
- Template-driven: skill provides zones; results map to zones by kind.
- Cluster-by-kind: free-layout with kind-similarity grouping.
- Timeline: time axis, source-row layout (used by `WhatsNewSinceY`).
- Graph: center node + radial neighbors (used by `TraceXEverywhere`).

**8 — Stream + persist.** Widgets render as skeletons immediately, hydrate
as Results arrive. Canvas auto-saves to a markdown bundle
(`~/.<app>/canvases/<id>/canvas.md` + per-widget JSON). Reopening replays
from markdown without re-querying.

### Error handling — explicit, never silent

| Failure                              | Behavior                                                  |
|--------------------------------------|-----------------------------------------------------------|
| MCP source unavailable               | Skip; place a `degraded-source` indicator widget          |
| LLM call fails                       | Error widget with retry button; preserve query            |
| Tool-call args malformed             | One auto-retry with corrected args; else error widget     |
| Amp returns non-JSON `result`        | One retry with stricter prompt; else `MarkdownWidget`     |
| Embedding mismatch post-profile-swap | "Re-index needed" banner with explicit user action        |
| Cache poisoned (stale wrong answer)  | Per-result Refresh action invalidates cache key           |

No silent failure; every failure mode produces a visible, actionable widget.

### Cancellation

Every query gets a cancellation token. Closing a widget mid-stream cancels;
partial Results stay on canvas; partial cache entry discarded. Streaming +
cancellation are first-class so the canvas always feels responsive.

### Testing layers

| Layer       | What                                                | Fixtures                                      |
|-------------|-----------------------------------------------------|-----------------------------------------------|
| Unit        | Schema validators, link resolver, dispatch, cache   | Pure functions, in-memory                     |
| Integration | Each `Source` adapter against recorded MCP servers  | `__fixtures__/mcp/<source>.jsonl`             |
| Integration | Each `LLMProvider` against recorded LLM transcripts | `__fixtures__/llm/<provider>.jsonl`           |
| E2E         | Full agent loop on canonical queries (fake providers)| Golden canvas markdown snapshots             |
| Manual      | Real MCP + real LLM smoke test                      | `docs/qa-smoke-test.md`                       |

Recording fakes from real servers gives high-fidelity tests with no ongoing
API cost. Replay them in CI.

---

## 7. Seed canvas templates and demo

The four generic templates that ship with v1:

### `AskAnything`
- **Layout:** free-canvas; pinned chat input at top.
- **Skill prompt:** "answer the user's question using configured Sources;
  return cited Result envelope."
- **Demo example:** "What does the `OrderProcessor` class do?" →
  CodeBlockWidget + linked WikiPageWidget + linked TicketCardWidget.

### `TellMeAboutX`
- **Layout:** grid with five zones (Header, Code, Docs, Activity, Related).
- **Skill prompt:** "X is the subject; fan out across all Sources; populate
  each zone with the most relevant K results; rank by recency × relevance."
- **Demo example:** "Tell me about the checkout service" → service summary +
  top-3 code files + top-3 wiki pages + recent commits/tickets timeline +
  upstream/downstream services.

### `WhatsNewSinceY`
- **Layout:** timeline; sources as horizontal lanes; time-axis x; widgets
  pinned to their timestamps.
- **Skill prompt:** "Y is a date or event; list events from each Source
  since Y; cluster related items."
- **Demo example:** "What's new since last Tuesday in the checkout service?"
  → multi-lane timeline of deploys, commits, tickets, alerts in time order.

### `TraceXEverywhere`
- **Layout:** graph; X centered; references radiating by source kind.
- **Skill prompt:** "X is a name/symbol; find all references across Sources;
  cluster by source; rank by reference type (definition > caller > mention)."
- **Demo example:** "Trace `processPayment` everywhere" → center node +
  code definition + callers (subgraph) + tests + Confluence mentions +
  Jira tickets that reference it.

### v1 release demo screencast (5 minutes)

```
0:00  Open app, profile=work
0:10  Profile health widget green for all configured sources
0:20  "What's new in the checkout service since last Tuesday?"
       → WhatsNewSinceY canvas materializes, multi-lane timeline
1:00  Click on a deploy event → drill: spawns CodeDiffWidget +
       linked TicketCardWidget for the closing Jira
1:30  "Why are 500s up since 14:00?"
       → AskAnything canvas: LogTimelineWidget + correlation with
       deploy timeline + linked code-symbol of the changed function
2:30  "Tell me about ServiceFoo"
       → TellMeAboutX template loads, all zones populate
3:30  Save canvas → reopen tomorrow, instant replay from markdown
4:00  Switch profile to home-claude → re-run same query, see how
       LLM choice affects synthesis quality
4:30  Show config.json — three profiles, swap is one click
5:00  End
```

---

## 8. Risks and v1 cut

### Top risks (in priority order)

1. **Amp structured-output reliability.** If Amp doesn't reliably emit JSON
   matching `ResultEnvelopeSchema`, agent-mode quality degrades.
   *Mitigation:* spike before any v1 code; parser fallback to
   `MarkdownWidget` preserves usefulness even when JSON breaks.
2. **Codebase indexing time.** A real monorepo could take hours.
   *Mitigation:* progressive availability; index progress as a canvas widget;
   live sources usable immediately.
3. **Bundled ONNX recall quality.** 384-dim local embeddings underperform
   cloud embeddings. *Mitigation:* hybrid retrieval — FTS5 BM25 always runs
   alongside vector; keyword search masks vector-recall gaps in code.
4. **Cross-source link resolver false positives.** Aggressive regex matching
   produces wrong links. *Mitigation:* confidence scoring; below-threshold
   links hidden; resolver decisions logged for tuning.
5. **Widget catalog churn under real use.** First contact with users will
   reveal missing widget shapes. *Mitigation:* the v2 escape hatch
   (LLM-emitted ad-hoc widget JSON) ships once we have signal on what's
   missing. Until then, `MarkdownWidget` + `KeyValueCardWidget` cover the
   long tail acceptably.
6. **Profile swap mid-query data corruption.** Switching providers while a
   query is running. *Mitigation:* profile is immutable during a query; swap
   forces query cancellation.

### Pre-v1 spikes (week 1, before any production code)

| # | Spike                                                                | Effort  |
|---|----------------------------------------------------------------------|---------|
| 1 | Amp MCP overlap test — does Amp behave correctly when configured     | ½–1 day |
|   | with the same MCP servers as our app, or do we hide MCP from Amp?    |         |
| 2 | Amp structured-output reliability — JSON envelope adherence          | ½ day   |
| 3 | Bundled ONNX viability — `bge-small-en-v1.5` via `onnxruntime-node`  | ½ day   |
|   | on macOS / Linux / Windows                                           |         |
| 4 | Anthropic OAuth public availability for third-party desktop apps —   | ¼ day   |
|   | confirm with current Anthropic docs                                  |         |
| 5 | Space-agent fork strategy — fork-and-modify vs. upstream + patches   | ½ day   |

### v1 timeline

Roughly **8–10 weeks** of focused work.

- Week 1: spikes 1–5; finalize architecture decisions
- Weeks 2–3: forked space-agent shell + MCP adapter + Source registry
- Weeks 3–4: index layer (codebase + documents) + cache
- Weeks 4–5: LLM provider layer + agent loop (model mode)
- Weeks 5–6: agent mode (Amp) + ResultEnvelope parsing
- Weeks 6–7: built-in widget catalog (14)
- Weeks 7–8: 4 canvas templates + cross-source link resolver
- Weeks 8–9: profile switching + onboarding UX + initial-sync UI
- Weeks 9–10: error handling polish + smoke tests + demo screencast

### v1 scope cut

**In:**
- Forked space-agent runtime
- Generic MCP adapter, capability introspection
- 15 result kinds, 14 built-in widgets
- 4 generic canvas templates
- SQLite + sqlite-vec + FTS5 index
- Bundled ONNX embedder + optional cloud / Ollama upgrades
- Provider-agnostic LLM (Amp + Anthropic key + OpenAI key + Ollama;
  Claude OAuth if available)
- Config-driven profiles + activation probe
- Cross-source link resolver
- Cache layer (prompt + result + embedding)
- Read-only across all sources
- Saved canvases as markdown bundles

**Out (v1.5 and later):**
- Persona seed packs (Developer-flavored first)
- LLM-emitted ad-hoc widgets
- Cross-repo code-graph
- Write-back to any source
- Multi-user sync / sharing
- Hosted SaaS deployment
- Realtime collaboration on canvases

---

## Appendix A — Glossary

| Term            | Meaning                                                          |
|-----------------|------------------------------------------------------------------|
| Source          | A configured MCP server                                          |
| Capability      | One of `search` / `fetch` / `list` / `subscribe` exposed by a Source |
| Result          | A typed retrieved item with provenance and freshness             |
| Kind            | Discriminator on `Result`; drives widget dispatch                |
| Widget          | A renderer bound to one or more `Kinds`                          |
| Skill           | Bundle of (canvas template + agent recipe + custom widgets)      |
| Profile         | Named config: LLM + embedder + sources                           |
| Canvas template | Layout strategy (free / grid / timeline / graph) with zones      |
| Result envelope | JSON contract returned by `agent`-kind providers                 |
| Cross-source link resolver | Component that converts inline refs into typed links  |

## Appendix B — File / module sketch (pre-implementation)

```
src/
├─ core/
│  ├─ source.ts              # Source, Capability types + adapter
│  ├─ result.ts              # Result, ResultKind, shape registry
│  ├─ widget.ts              # Widget interface + registry
│  └─ skill.ts               # Skill loader (SKILL.md + frontmatter)
├─ providers/
│  ├─ llm/
│  │  ├─ index.ts            # LLMProvider interface
│  │  ├─ amp.ts              # AmpAdapter (agent kind)
│  │  ├─ anthropic.ts        # API key + OAuth
│  │  ├─ openai.ts
│  │  ├─ openai-compat.ts
│  │  └─ ollama.ts
│  └─ embed/
│     ├─ index.ts
│     ├─ onnx-bundled.ts     # default
│     ├─ openai.ts
│     ├─ voyage.ts
│     └─ ollama.ts
├─ index/
│  ├─ orchestrator.ts        # scheduler + progress
│  ├─ code.ts                # tree-sitter + AST chunker
│  ├─ document.ts            # PDF / HTML / MD chunker
│  ├─ ticket.ts              # Jira-shape indexer
│  ├─ store.ts               # SQLite + sqlite-vec + FTS5
│  └─ resolver.ts            # cross-source link resolver
├─ agent/
│  ├─ enrich.ts              # query enrichment
│  ├─ intent.ts              # rule + LLM classifier
│  ├─ skill-match.ts
│  ├─ cache.ts
│  ├─ executor-model.ts      # tool-calling loop
│  ├─ executor-agent.ts      # Amp delegator
│  ├─ envelope.ts            # ResultEnvelope schema + parser
│  └─ dispatch.ts            # widget dispatch + layout
├─ widgets/
│  ├─ markdown.tsx
│  ├─ code-block.tsx
│  ├─ code-diff.tsx
│  ├─ ticket-card.tsx
│  ├─ wiki-page.tsx
│  ├─ log-timeline.tsx
│  ├─ k8s-resource.tsx
│  ├─ web-embed.tsx
│  ├─ table.tsx
│  ├─ key-value-card.tsx
│  ├─ metric-chart.tsx
│  ├─ chat-message.tsx
│  ├─ runbook.tsx
│  └─ dashboard-embed.tsx
├─ skills/
│  └─ defaults/              # default-{lookup,synthesize,investigate,render,navigate}
├─ canvas/
│  ├─ templates/             # AskAnything, TellMeAboutX, WhatsNewSinceY, TraceXEverywhere
│  ├─ layout/                # free, grid, timeline, graph
│  └─ persistence.ts         # markdown bundle save/load
├─ config/
│  ├─ profiles.ts
│  └─ probe.ts               # activation probe (LLM, embed, MCP)
└─ ui/
   └─ ...                    # forked from space-agent
```

This is a sketch, not a contract. Final structure follows space-agent's
conventions where they conflict with the above.

---

*End of design spec.*
