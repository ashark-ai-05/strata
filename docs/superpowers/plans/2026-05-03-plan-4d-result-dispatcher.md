# Plan 4d — Result Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the canvas to receive `Result`s from real backend operations and materialize them as widgets. Add a `/v1/search` backend endpoint, a frontend `dispatcher.ts` that maps `Result.kind` → `ShapeUtil.type` via the registry from Plan 4c, and a `SearchBar` in the canvas overlay that lets the user type a query and see chunks land as widgets.

**Architecture:** A new POST `/v1/search` endpoint in the backend wraps the existing `SearchService` (Plan 3a). Returns a `{ results: Result[] }` envelope. Frontend's `dispatcher.placeResultsOnCanvas(editor, results)` iterates results, picks the right `shapeType` from `WIDGET_REGISTRY` (Plan 4c), and creates one shape per result with a simple cluster-by-kind layout. A `SearchBar` overlay above the canvas shows a text input — typing → debounced fetch → place results. No chat-side tool-calling in 4d (deferred to later); search is a parallel, keyboard-driven entrypoint.

**Tech Stack additions:** None — reuses existing backend HTTP + tldraw.

**References:**
- Plan 4c: `docs/superpowers/plans/2026-05-03-plan-4c-widget-catalog.md` — widgets + `WIDGET_REGISTRY`
- Plan 3a: `docs/superpowers/plans/2026-05-02-plan-3a-document-indexer-and-search.md` — `SearchService`
- Design spec §3 — `Result<K>` shape; `ResultEnvelope` schema in `src/core/envelope.ts`

**Out of scope:**
- Chat-side tool-calling that lets Claude place widgets autonomously (Plan 4d.1 if/when wanted — needs backend tool-call passthrough)
- Canvas templates (AskAnything, TellMeAboutX, etc.) — Plan 4e
- Live re-fetch / freshness handling for placed widgets — defer
- Cross-source link resolution overlay (Plan 3e)

---

## File structure

### New files

```
src/backend/routes/
  search.ts                                  # POST /v1/search route
__tests__/
  backend-search.test.ts                     # backend route smoke
app/src/
  api/
    search.ts                                # frontend API client
  canvas/
    dispatcher.ts                            # Result[] → tldraw shapes; cluster layout
  components/
    SearchBar.tsx                            # canvas-overlay search input
__tests__/app/
  dispatcher.test.ts
  SearchBar.test.tsx
```

### Modified files

```
src/backend/server.ts                        # mount the new search route
src/backend/state.ts                         # expose default store for the search route
app/src/canvas/Canvas.tsx                    # mount SearchBar inside Tldraw overlay
README.md                                    # document /v1/search + dispatcher
```

### Files NOT touched

`src/providers/`, `src/embedders/`, `src/storage/store.ts` (just consumed via openDefaultStore), `src/mcp/`, `src/indexer/`, `src/search/service.ts` (consumed as-is), shape utils from Plan 4c, the chat panel from Plan 4a — all stable.

---

## Task 0: Backend route — `/v1/search`

**Files:**
- Create: `src/backend/routes/search.ts`
- Modify: `src/backend/server.ts`
- Modify: `src/backend/state.ts`
- Test: `__tests__/backend-search.test.ts`

The backend currently has `BackendState` with provider + embedder + sources. Add a lazily-opened default store (sqlite) for the search route. The route accepts `{ query, limit? }` and returns `{ results: Result[] }`.

The result objects we return mirror the design-spec `Result` shape closely enough for the frontend dispatcher:

```typescript
type Result = {
  id: string;          // chunk id
  sourceId: string;    // source_id from chunks table
  kind: ResultKind;    // mapped from chunks.kind
  shape: object;       // payload — varies by kind
  provenance: { uri: string; fetchedAt: number };
  freshness: { ttlMs?: number };
  links: [];           // empty in 4d (Plan 3e populates)
};
```

For the chunks our indexer already produces:

| chunks.kind | Result.kind | shape payload |
| --- | --- | --- |
| `text-document` | `text-document` | `{ title, body }` (title from URI basename) |
| `code-symbol` | `code-symbol` | `{ symbolName, filePath, language, body }` (read meta_json) |
| `code-file` | `code-file` | `{ filePath, body }` |

- [ ] **Step 1: Write the backend route smoke test**

Create `__tests__/backend-search.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { app } from '../src/backend/server.js';

describe('POST /v1/search', () => {
  it('returns 400 when query is missing or empty', async () => {
    const r1 = await app.request('/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(400);

    const r2 = await app.request('/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '   ' }),
    });
    expect(r2.status).toBe(400);
  });

  it('returns 200 with a results array on a valid query', async () => {
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'authentication' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: unknown[] };
    expect(Array.isArray(json.results)).toBe(true);
  });
});
```

- [ ] **Step 2: Add a lazy default store accessor to `BackendState`**

Read `src/backend/state.ts`. Add a memoized accessor:

```typescript
import { openDefaultStore, type Store } from '../storage/store.js';

// Inside BackendState:
private storePromise: Promise<Store> | null = null;

async getStore(): Promise<Store> {
  if (!this.storePromise) {
    this.storePromise = openDefaultStore();
  }
  return this.storePromise;
}
```

- [ ] **Step 3: Implement the route**

Create `src/backend/routes/search.ts`:

```typescript
import { Hono } from 'hono';
import type { BackendState } from '../state.js';
import { SearchService } from '../../search/service.js';
import type { ResultKind } from '../../core/source.js';

type Result = {
  id: string;
  sourceId: string;
  kind: ResultKind;
  shape: Record<string, unknown>;
  provenance: { uri: string; fetchedAt: number };
  freshness: { ttlMs?: number };
  links: [];
};

export function searchRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/search', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      limit?: number;
    };
    const query = (body.query ?? '').trim();
    if (!query) {
      return c.json({ error: 'query is required' }, 400);
    }

    const store = await state.getStore();
    const embedder = state.getEmbedder();
    const service = new SearchService({ store, embedder });
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 10)));

    const hits = await service.search(query, { limit });

    // Hydrate each hit with its chunk meta + map to the Result envelope.
    const results: Result[] = hits.map((h) => {
      const row = store.db
        .prepare('SELECT meta_json, kind FROM chunks WHERE id = ?')
        .get(h.chunkId) as { meta_json: string | null; kind: string } | undefined;
      const meta = row?.meta_json ? JSON.parse(row.meta_json) : {};
      const kind = (row?.kind ?? 'text-document') as ResultKind;
      return {
        id: String(h.chunkId),
        sourceId: h.sourceId,
        kind,
        shape: shapeForKind(kind, h.body, h.uri, meta),
        provenance: { uri: h.uri, fetchedAt: Date.now() },
        freshness: {},
        links: [],
      };
    });

    return c.json({ results });
  });

  return r;
}

function shapeForKind(
  kind: ResultKind,
  body: string,
  uri: string,
  meta: Record<string, unknown>
): Record<string, unknown> {
  // Best-effort mapping — the frontend dispatcher knows the shape format
  // for each widget. Keep these aligned with the props each ShapeUtil
  // declares in app/src/canvas/shapes/*.tsx.
  if (kind === 'code-symbol' || kind === 'code-file') {
    return {
      symbolName: typeof meta.symbolName === 'string' ? meta.symbolName : undefined,
      filePath: typeof meta.file === 'string' ? meta.file : titleFromUri(uri),
      language: typeof meta.language === 'string' ? meta.language : undefined,
      body,
    };
  }
  if (kind === 'text-document' || kind === 'wiki-page') {
    return {
      title: titleFromUri(uri),
      body,
    };
  }
  // Fallback — KeyValueCard renders these.
  return {
    title: titleFromUri(uri),
    pairs: [
      { key: 'kind', value: kind },
      { key: 'uri', value: uri },
      { key: 'body', value: body.slice(0, 200) + (body.length > 200 ? '…' : '') },
    ],
  };
}

function titleFromUri(uri: string): string {
  if (!uri) return 'Untitled';
  try {
    const u = new URL(uri);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || u.host || uri;
  } catch {
    return uri.split('/').pop() || uri;
  }
}
```

- [ ] **Step 4: Mount the route in server.ts**

Read `src/backend/server.ts` and add `searchRoute` to the route list (mirroring how query/embed/sources/health/queryOpenAI are mounted). Import:

```typescript
import { searchRoute } from './routes/search.js';
```

And add `app.route('/', searchRoute(s));` in both the lazy mount middleware and `start()`.

- [ ] **Step 5: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: all pass, including the 2 new `/v1/search` tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/routes/search.ts src/backend/server.ts src/backend/state.ts __tests__/backend-search.test.ts
git commit -m "feat(backend): POST /v1/search — wraps SearchService into Result envelope"
```

---

## Task 1: Frontend search API client

**Files:**
- Create: `app/src/api/search.ts`

- [ ] **Step 1: Implement**

Create `app/src/api/search.ts`:

```typescript
import type { ResultKind } from '../../../src/core/source';

export type SearchResult = {
  id: string;
  sourceId: string;
  kind: ResultKind;
  shape: Record<string, unknown>;
  provenance: { uri: string; fetchedAt: number };
  freshness: { ttlMs?: number };
  links: [];
};

export type SearchResponse = {
  results: SearchResult[];
};

export async function search(query: string, limit = 10): Promise<SearchResponse> {
  const res = await fetch('/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Search failed: ${(err as { error?: string }).error ?? res.statusText}`);
  }
  return res.json() as Promise<SearchResponse>;
}
```

The cross-package import (`../../../src/core/source`) works because Vite's resolver respects the relative path. If TypeScript complains, add `"include": ["src", "../src/core"]` to `app/tsconfig.json`.

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/api/search.ts
git commit -m "feat(app): /v1/search API client + SearchResult types"
```

---

## Task 2: Dispatcher — `Result[]` → tldraw shapes

**Files:**
- Create: `app/src/canvas/dispatcher.ts`
- Test: `__tests__/app/dispatcher.test.ts`

Pure function that, given a tldraw `Editor` and a list of `SearchResult`s, creates one shape per result. Layout strategy for v1: simple grid clustered by kind (code in one column, docs in another, tickets in another).

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { placeResultsOnCanvas } from '../../app/src/canvas/dispatcher';
import type { SearchResult } from '../../app/src/api/search';

describe('placeResultsOnCanvas', () => {
  it('creates one shape per result', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    const results: SearchResult[] = [
      {
        id: '1', sourceId: 's', kind: 'text-document',
        shape: { title: 'A', body: '...' },
        provenance: { uri: 'file://a', fetchedAt: 0 }, freshness: {}, links: [],
      },
      {
        id: '2', sourceId: 's', kind: 'code-symbol',
        shape: { symbolName: 'foo', filePath: 'a.ts', body: 'fn' },
        provenance: { uri: 'file://a.ts#foo', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ];

    placeResultsOnCanvas(editor as never, results);

    expect(editor.createShape).toHaveBeenCalledTimes(2);
  });

  it('maps a text-document result to the markdown shape type', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'text-document',
        shape: { title: 'A', body: 'B' },
        provenance: { uri: 'file://a', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('llm-wiki:markdown');
    expect(call.props.title).toBe('A');
    expect(call.props.body).toBe('B');
  });

  it('maps a code-symbol result to the code-block shape type with metadata', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'code-symbol',
        shape: { symbolName: 'foo', filePath: 'a.ts', language: 'typescript', body: 'fn' },
        provenance: { uri: 'file://a.ts#foo', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('llm-wiki:code-block');
    expect(call.props.symbolName).toBe('foo');
    expect(call.props.filePath).toBe('a.ts');
    expect(call.props.language).toBe('typescript');
  });

  it('falls back to key-value-card for unmapped kinds', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'log-stream' as never,
        shape: { title: 'log', pairs: [{ key: 'host', value: 'x' }] },
        provenance: { uri: 'mem://log', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('llm-wiki:key-value-card');
  });
});
```

- [ ] **Step 2: Implement**

Create `app/src/canvas/dispatcher.ts`:

```typescript
import type { Editor } from 'tldraw';
import { pickWidgetForKind } from '../../../src/core/widget-registry';
import type { SearchResult } from '../api/search';

const COL_WIDTH = 380;
const ROW_HEIGHT = 240;
const CLUSTER_GAP = 60;

/**
 * Convert a Result.shape (already shaped by the backend) into the props
 * expected by the corresponding ShapeUtil. The widget registry tells us
 * what shapeType to use; this function fills in any defaults the shape
 * declares as required.
 */
function shapeProps(
  shapeType: string,
  result: SearchResult
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...result.shape, uri: result.provenance.uri };

  switch (shapeType) {
    case 'llm-wiki:markdown':
      return { w: 360, h: 240, ...base };
    case 'llm-wiki:code-block':
      return { w: 480, h: 280, ...base };
    case 'llm-wiki:ticket':
      return {
        w: 320,
        h: 200,
        ticketId: result.id,
        title: result.shape.title ?? 'Untitled',
        ...base,
      };
    case 'llm-wiki:web-embed':
      return { w: 480, h: 320, url: (result.shape as { url?: string }).url ?? '', ...base };
    case 'llm-wiki:key-value-card':
    default:
      return {
        w: 320,
        h: 200,
        title: (result.shape as { title?: string }).title ?? result.kind,
        pairs: (result.shape as { pairs?: Array<{ key: string; value: string }> }).pairs ?? [],
        ...base,
      };
  }
}

/**
 * Group results by kind, then place each group as a column on the canvas.
 * Origin is the top-left of the current viewport, plus a small inset.
 */
export function placeResultsOnCanvas(
  editor: Editor,
  results: SearchResult[]
): void {
  if (results.length === 0) return;

  const viewport = editor.getViewportPageBounds();
  const originX = viewport.x + 80;
  const originY = viewport.y + 100;

  const byKind = new Map<string, SearchResult[]>();
  for (const r of results) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }

  let col = 0;
  for (const [, group] of byKind) {
    let row = 0;
    for (const r of group) {
      const widget = pickWidgetForKind(r.kind);
      const props = shapeProps(widget.shapeType, r);
      editor.createShape({
        type: widget.shapeType,
        x: originX + col * (COL_WIDTH + CLUSTER_GAP),
        y: originY + row * (ROW_HEIGHT + 20),
        props,
      });
      row++;
    }
    col++;
  }
}
```

- [ ] **Step 3: Run the test**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/dispatcher.test.ts
```

Expected: PASS, all 4 tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/dispatcher.ts __tests__/app/dispatcher.test.ts
git commit -m "feat(app): canvas dispatcher — Result[] → shapes via WIDGET_REGISTRY"
```

---

## Task 3: SearchBar component

**Files:**
- Create: `app/src/components/SearchBar.tsx`
- Test: `__tests__/app/SearchBar.test.tsx`

A small overlay floating in the top-right of the canvas. User types → debounced fetch → dispatcher places results.

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/SearchBar.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SearchBar } from '../../app/src/components/SearchBar';

// Mock the dispatcher so we don't need a real tldraw editor.
vi.mock('../../app/src/canvas/dispatcher', () => ({
  placeResultsOnCanvas: vi.fn(),
}));

// Mock the editor hook from tldraw — return a minimal editor stub.
vi.mock('tldraw', async () => {
  const actual = await vi.importActual<typeof import('tldraw')>('tldraw');
  return {
    ...actual,
    useEditor: () => ({ createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) }),
  };
});

describe('SearchBar', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders an input', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('fires a search when the form is submitted', async () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'authentication' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/v1/search',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
```

- [ ] **Step 2: Implement**

Create `app/src/components/SearchBar.tsx`:

```typescript
import { useEditor } from 'tldraw';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { search } from '../api/search';
import { placeResultsOnCanvas } from '../canvas/dispatcher';

export function SearchBar() {
  const editor = useEditor();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;

    setBusy(true);
    setError(null);
    try {
      const { results } = await search(q, 10);
      placeResultsOnCanvas(editor, results);
      setQuery('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 200,
        display: 'flex',
        gap: 6,
        padding: 6,
        background: 'rgba(24, 24, 27, 0.95)',
        border: '1px solid #3f3f46',
        borderRadius: 8,
        backdropFilter: 'blur(8px)',
        alignItems: 'center',
        minWidth: 280,
      }}
    >
      <Search size={14} color="#71717a" style={{ marginLeft: 4 }} />
      <input
        type="text"
        placeholder="Search indexed content…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
        aria-label="Search"
        style={{
          flex: 1,
          padding: '4px 8px',
          fontSize: 13,
          background: 'transparent',
          color: '#fafafa',
          border: 'none',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        disabled={busy || !query.trim()}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          background: '#27272a',
          color: '#fafafa',
          border: '1px solid #3f3f46',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {busy ? 'Searching…' : 'Search'}
      </button>
      {error && (
        <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>{error}</span>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Run the test**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/SearchBar.test.tsx
```

Expected: PASS, both tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/components/SearchBar.tsx __tests__/app/SearchBar.test.tsx
git commit -m "feat(app): SearchBar — canvas overlay; types → /v1/search → dispatcher"
```

---

## Task 4: Mount SearchBar in Canvas

**Files:**
- Modify: `app/src/canvas/Canvas.tsx`

- [ ] **Step 1: Add import + mount**

Read `app/src/canvas/Canvas.tsx`. Add:

```typescript
import { SearchBar } from '../components/SearchBar';
```

And inside the `<Tldraw>` element children (alongside `<DebugToolbar />`):

```typescript
<Tldraw
  shapeUtils={customShapeUtils}
  snapshot={initialSnapshot}
  onMount={handleMount}
>
  <DebugToolbar />
  <SearchBar />
</Tldraw>
```

- [ ] **Step 2: Build + smoke**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm app:build
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/Canvas.tsx
git commit -m "feat(app): mount SearchBar in canvas overlay"
```

---

## Task 5: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append**

Add to the canvas section:

```markdown
### Result dispatcher (Plan 4d)

The canvas now has a search overlay in the top-right. Type a query, press Search, and matching chunks from your indexed content materialize as widgets on the canvas (clustered by kind in columns).

Under the hood:
1. `SearchBar` POSTs to `/v1/search` with `{ query, limit }`
2. Backend (`src/backend/routes/search.ts`) wraps `SearchService` from Plan 3a, hydrates each hit's `meta_json`, and returns `{ results: Result[] }` per spec §3
3. `placeResultsOnCanvas(editor, results)` looks up each Result.kind in `WIDGET_REGISTRY` and calls `editor.createShape(...)` with the right shape type and props
4. Layout strategy: simple cluster-by-kind grid (one column per kind, fills downward). Plan 4e adds template-driven layouts (timeline, graph, etc.)

#### Try it

\`\`\`bash
# Make sure something is indexed first
pnpm cli --index docs/superpowers/
pnpm cli --index-code src/

# Then in the app, search "auth" or "MCPSource" — chunks should land as widgets
\`\`\`

### What's next (Plan 4e)

- **4e**: Canvas templates — AskAnything (free), TellMeAboutX (grid with named zones), WhatsNewSinceY (timeline), TraceXEverywhere (graph)
```

(Use real triple-backticks in the actual README.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: result dispatcher + /v1/search + SearchBar overlay"
```

---

## Spec coverage check

| Spec / vision | Implemented in (Plan 4d) | Deferred to |
| --- | --- | --- |
| §3 — `Result` type returned from backend | Task 0 (`/v1/search`) | — |
| §3 — `WIDGET_REGISTRY` consumption | Task 2 (dispatcher) | — |
| §3 — cluster-by-kind layout | Task 2 | Plan 4e (templates) |
| §3 — `Capability.search` verb | — (we wrap our local index, not MCP search yet) | Plan 3g |
| §6 — agent-side dispatch / tool-call wiring | — | Plan 4d.1 |

All Plan 4d deliverables traced.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0 (root + app)
- [ ] Typecheck passes: `pnpm typecheck` + `cd app && pnpm exec tsc --noEmit`
- [ ] `pnpm app:build` exits 0
- [ ] `curl -s http://127.0.0.1:3457/v1/search -H 'content-type: application/json' -d '{"query":"hello"}'` returns `{ results: [...] }` (when backend running with indexed content)
- [ ] Manual smoke: `pnpm dev:app`, open canvas, type "auth" or any indexed term in the SearchBar, results appear as widgets
- [ ] `git log --oneline` shows ~6 new commits

---

*End of Plan 4d.*
