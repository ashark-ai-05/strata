# Plan 3a — Document Indexer + Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first indexer (document/markdown/text from a local directory) and hybrid search (BM25 + vector via sqlite-vec) over the indexed chunks. Exposed via CLI: `pnpm cli --index <path>` and `pnpm cli --search "<query>"`.

**Plan 3 decomposition:** Per design spec §4, the full indexing layer covers code (tree-sitter), documents (markdown/HTML/PDF), tickets, an orchestrator, capability verb mapping, and a cross-source link resolver. That's a multi-week effort. This plan is **Plan 3a**, the first slice; subsequent slices ship as separate plans:

- **3a (this plan):** Document indexer (text/markdown only, filesystem source) + hybrid search.
- **3b:** PDF / HTML support added to the document indexer.
- **3c:** Code indexer (tree-sitter, AST-aware chunking, intra-file symbol graph).
- **3d:** Ticket indexer (Jira-shape via MCP).
- **3e:** Cross-source link resolver (regex pass + index lookup + fuzzy).
- **3f:** Index orchestrator (scheduling, incremental sync, MCP-driven).
- **3g:** Capability verb mapping (`search`/`fetch`/`list`/`subscribe`) over MCP tools.

The decomposition is documented here for visibility. Each sub-plan ships independently.

**Architecture (Plan 3a only):** A `DocumentIndexer` walks a local directory, reads each `.md` / `.markdown` / `.txt` file, runs a chunking pass (paragraph-aware, sliding window with overlap), embeds each chunk via the active profile's `EmbeddingProvider`, and writes rows to `chunks` and `embeddings` (Plan 1's schema). A `SearchService` exposes a hybrid query: FTS5 for BM25 + sqlite-vec for cosine; results are merged via reciprocal rank fusion (RRF). CLI commands surface both.

**Tech Stack:** Node.js 24+ · TypeScript · existing `better-sqlite3` + `sqlite-vec` + bundled ONNX from Plan 1 · Vitest. No new heavy deps in 3a (PDF parsers, tree-sitter, etc. arrive in 3b/3c).

**References:**
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §4 (indexing + cache layer schema, hybrid retrieval policy)
- Plan 1 implementation: `chunks` / `embeddings` / `fts` schema already in place; bundled ONNX embedder works
- Spec amendment 3: pre-warm note (still relevant — search latency benefits from warm embedder)

**Out of scope (deferred to later 3x plans):**
- PDF / HTML extraction (3b)
- Code-aware chunking, tree-sitter symbol extraction (3c)
- Ticket-shape indexers (3d)
- MCP-driven index sources (3f — for v1, indexer takes a local path; MCP integration comes once the orchestrator lands)
- Re-index on file change (3f)
- Cross-source link enrichment of chunks (3e)
- `Capability` verb routing (3g)

---

## File structure

### New files

```
src/
  indexer/
    chunker.ts                  # splitText(text, options) → Chunk[]
    document-indexer.ts         # DocumentIndexer.run({ rootPath, sourceId }) → IndexResult
    fs-walk.ts                  # asyncIterable of .md/.txt files under a directory
  search/
    service.ts                  # SearchService — hybrid BM25 + vector + RRF
__tests__/
  chunker.test.ts
  document-indexer.test.ts      # uses a tmp directory of fixture files
  search.test.ts                # exercises hybrid retrieval against a seeded store
```

### Modified files

```
src/cli.ts                       # add --index <path> and --search "<query>"
src/storage/store.ts             # (optional) export a small `openDefaultStore()` helper that opens ~/.llm-wiki/index.sqlite + runs migrations
README.md                        # Indexing + Search section
```

### Files NOT modified

`src/core/**`, `src/providers/**`, `src/embedders/**`, `src/mcp/**`, `src/backend/**`, `src/config/**` — Plan 1' through 1.6 stay stable.

---

## Task 0: Storage convenience — openDefaultStore

**Files:**
- Modify: `src/storage/store.ts`
- Test: `__tests__/storage.test.ts`

This task adds a single convenience helper so indexer + search code (and the existing `--storage-status` CLI from Plan 1) all open the store the same way: `~/.llm-wiki/index.sqlite` with migrations applied. Reduces duplication.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/storage.test.ts`:

```typescript
import { openDefaultStore } from '../src/storage/store.js';

describe('openDefaultStore', () => {
  it('opens an in-memory store when LLM_WIKI_STORE_PATH=:memory:', async () => {
    process.env.LLM_WIKI_STORE_PATH = ':memory:';
    try {
      const store = await openDefaultStore();
      // Migrations are applied; chunks table should exist.
      const tables = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      expect(tables.some((t) => t.name === 'chunks')).toBe(true);
      store.close();
    } finally {
      delete process.env.LLM_WIKI_STORE_PATH;
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: FAIL — `openDefaultStore` not exported.

- [ ] **Step 3: Implement `openDefaultStore`**

Append to `src/storage/store.ts`:

```typescript
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

/**
 * Opens the user-default store at `~/.llm-wiki/index.sqlite`, creating
 * the directory and running migrations on first call. Override the path
 * with the `LLM_WIKI_STORE_PATH` env var (set to `:memory:` for tests).
 */
export async function openDefaultStore(): Promise<Store> {
  const override = process.env.LLM_WIKI_STORE_PATH;
  const path =
    override ??
    (() => {
      const dir = `${homedir()}/.llm-wiki`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      return `${dir}/index.sqlite`;
    })();

  const store = await openStore({ path });
  const { migrate } = await import('./migrations.js');
  await migrate(store, await loadInitialMigrations());
  return store;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/storage/store.ts __tests__/storage.test.ts
git commit -m "feat(storage): openDefaultStore — opens ~/.llm-wiki/index.sqlite with migrations"
```

---

## Task 1: Chunker — paragraph-aware sliding window

**Files:**
- Create: `src/indexer/chunker.ts`
- Test: `__tests__/chunker.test.ts`

Splits text into chunks of a target size (default ~500 chars) with overlap (~50 chars) at paragraph or sentence boundaries when possible. Simple v1; AST-aware code chunking is Plan 3c.

- [ ] **Step 1: Write the failing test**

Create `__tests__/chunker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { splitText } from '../src/indexer/chunker.js';

describe('splitText', () => {
  it('returns the whole text as one chunk when shorter than target', () => {
    const out = splitText('hello world', { targetSize: 500, overlap: 50 });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('hello world');
    expect(out[0].startChar).toBe(0);
    expect(out[0].endChar).toBe('hello world'.length);
  });

  it('splits on paragraph boundaries when possible', () => {
    const text = `${'a'.repeat(300)}\n\n${'b'.repeat(300)}\n\n${'c'.repeat(300)}`;
    const out = splitText(text, { targetSize: 350, overlap: 0 });
    expect(out.length).toBeGreaterThanOrEqual(2);
    // First chunk should end at or near a paragraph break
    expect(out[0].text.includes('a'.repeat(300))).toBe(true);
  });

  it('overlaps chunks by approximately the configured amount', () => {
    const text = 'A'.repeat(2000);
    const out = splitText(text, { targetSize: 500, overlap: 100 });
    expect(out.length).toBeGreaterThan(2);
    // Adjacent chunks should share some characters
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startChar).toBeLessThan(out[i - 1].endChar);
    }
  });

  it('rejects targetSize <= overlap', () => {
    expect(() =>
      splitText('hi', { targetSize: 100, overlap: 100 })
    ).toThrow(/overlap/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test chunker
```

Expected: FAIL — `chunker.js` not found.

- [ ] **Step 3: Implement the chunker**

Create `src/indexer/chunker.ts`:

```typescript
export type Chunk = {
  text: string;
  startChar: number;
  endChar: number;
};

export type ChunkOptions = {
  targetSize: number; // characters per chunk (approximate)
  overlap: number;    // characters of overlap between adjacent chunks
};

/**
 * Splits text into chunks of approximately targetSize characters,
 * overlapping by `overlap` characters. Prefers paragraph (\n\n) and
 * sentence (. ) boundaries when one is within ±10% of targetSize.
 */
export function splitText(text: string, options: ChunkOptions): Chunk[] {
  if (options.overlap >= options.targetSize) {
    throw new Error(
      `overlap (${options.overlap}) must be smaller than targetSize (${options.targetSize})`
    );
  }
  if (text.length <= options.targetSize) {
    return [{ text, startChar: 0, endChar: text.length }];
  }

  const chunks: Chunk[] = [];
  const tolerance = Math.floor(options.targetSize * 0.1);
  let pos = 0;

  while (pos < text.length) {
    const idealEnd = Math.min(text.length, pos + options.targetSize);
    let end = idealEnd;

    if (idealEnd < text.length) {
      // Look for a paragraph break within tolerance
      const paragraphIdx = text.lastIndexOf('\n\n', idealEnd);
      if (paragraphIdx >= idealEnd - tolerance && paragraphIdx > pos) {
        end = paragraphIdx;
      } else {
        // Fall back to sentence-ish break
        const sentenceIdx = Math.max(
          text.lastIndexOf('. ', idealEnd),
          text.lastIndexOf('.\n', idealEnd)
        );
        if (sentenceIdx >= idealEnd - tolerance && sentenceIdx > pos) {
          end = sentenceIdx + 1; // include the period
        }
      }
    }

    chunks.push({
      text: text.slice(pos, end),
      startChar: pos,
      endChar: end,
    });

    if (end >= text.length) break;
    pos = end - options.overlap;
  }

  return chunks;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test chunker
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/chunker.ts __tests__/chunker.test.ts
git commit -m "feat(indexer): paragraph-aware chunker with sliding-window overlap"
```

---

## Task 2: Filesystem walker

**Files:**
- Create: `src/indexer/fs-walk.ts`

Yields paths of `.md`, `.markdown`, and `.txt` files under a root directory. Uses Node's built-in `fs.readdir({recursive: true})`. Skips dot-directories and `node_modules`.

- [ ] **Step 1: Implement the walker**

Create `src/indexer/fs-walk.ts`:

```typescript
import { readdir, stat } from 'node:fs/promises';
import { join, extname, relative, sep } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'vendor']);

/**
 * Async-iterates absolute paths of .md / .markdown / .txt files under root.
 * Skips dot-directories, node_modules, and other build directories.
 */
export async function* walkTextFiles(root: string): AsyncIterable<string> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      yield* walkTextFiles(path);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      yield path;
    }
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/fs-walk.ts
git commit -m "feat(indexer): walkTextFiles — recursive .md/.txt walker"
```

---

## Task 3: DocumentIndexer

**Files:**
- Create: `src/indexer/document-indexer.ts`
- Test: `__tests__/document-indexer.test.ts`

Wires walker + chunker + embedder + store. Idempotent re-runs: on conflict (same `(source_id, uri)`), updates the existing chunk and replaces its embedding.

- [ ] **Step 1: Write the failing test**

Create `__tests__/document-indexer.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, loadInitialMigrations } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { DocumentIndexer } from '../src/indexer/document-indexer.js';
import type { EmbeddingProvider } from '../src/core/embedding-provider.js';

class FakeEmbedder implements EmbeddingProvider {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      const seed = t.charCodeAt(0) || 1;
      for (let i = 0; i < this.dims; i++) v[i] = (seed % (i + 7)) / 100;
      return v;
    });
  }
  async probe() {
    return { ok: true as const, dims: this.dims };
  }
}

describe('DocumentIndexer', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'llm-wiki-doc-test-'));
    writeFileSync(join(fixtureDir, 'a.md'), '# Title A\n\nThis is body A with content.');
    writeFileSync(join(fixtureDir, 'b.txt'), 'Plain text body B with different content.');
  });

  afterAll(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('indexes every .md/.txt file in a directory', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();

    const indexer = new DocumentIndexer({ store, embedder });
    const result = await indexer.run({ rootPath: fixtureDir, sourceId: 'fixtures' });

    expect(result.indexedFiles).toBe(2);
    expect(result.chunks).toBeGreaterThanOrEqual(2);
    expect(result.errors).toEqual([]);

    const chunkCount = (
      store.db.prepare('SELECT count(*) AS c FROM chunks').get() as { c: number }
    ).c;
    expect(chunkCount).toBeGreaterThanOrEqual(2);

    const embCount = (
      store.db.prepare('SELECT count(*) AS c FROM embeddings').get() as { c: number }
    ).c;
    expect(embCount).toBe(chunkCount);

    store.close();
  });

  it('is idempotent on re-run (no duplicate chunks)', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();
    const indexer = new DocumentIndexer({ store, embedder });

    await indexer.run({ rootPath: fixtureDir, sourceId: 'fixtures' });
    const firstCount = (
      store.db.prepare('SELECT count(*) AS c FROM chunks').get() as { c: number }
    ).c;

    await indexer.run({ rootPath: fixtureDir, sourceId: 'fixtures' });
    const secondCount = (
      store.db.prepare('SELECT count(*) AS c FROM chunks').get() as { c: number }
    ).c;

    expect(secondCount).toBe(firstCount);
    store.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test document-indexer
```

Expected: FAIL — `document-indexer.js` not found.

- [ ] **Step 3: Implement the indexer**

Create `src/indexer/document-indexer.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Store } from '../storage/store.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import { splitText } from './chunker.js';
import { walkTextFiles } from './fs-walk.js';

const DEFAULT_TARGET_SIZE = 500;
const DEFAULT_OVERLAP = 50;

export type IndexResult = {
  indexedFiles: number;
  chunks: number;
  errors: { path: string; error: string }[];
};

export type DocumentIndexerOptions = {
  store: Store;
  embedder: EmbeddingProvider;
  targetSize?: number;
  overlap?: number;
};

export type RunOptions = {
  rootPath: string;
  sourceId: string;
};

export class DocumentIndexer {
  private readonly store: Store;
  private readonly embedder: EmbeddingProvider;
  private readonly targetSize: number;
  private readonly overlap: number;

  constructor(options: DocumentIndexerOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
    this.targetSize = options.targetSize ?? DEFAULT_TARGET_SIZE;
    this.overlap = options.overlap ?? DEFAULT_OVERLAP;
  }

  async run(opts: RunOptions): Promise<IndexResult> {
    const errors: { path: string; error: string }[] = [];
    let indexedFiles = 0;
    let totalChunks = 0;

    const root = resolve(opts.rootPath);

    for await (const path of walkTextFiles(root)) {
      try {
        const body = await readFile(path, 'utf8');
        const chunks = splitText(body, {
          targetSize: this.targetSize,
          overlap: this.overlap,
        });
        const uri = `file://${path}`;

        // Delete prior chunks for this URI so re-runs are idempotent.
        // chunks has UNIQUE (source_id, uri) so we delete by both.
        const deleteOld = this.store.db.prepare(
          `DELETE FROM chunks WHERE source_id = ? AND uri = ?`
        );
        deleteOld.run(opts.sourceId, uri);

        // For multi-chunk files, store each chunk under a fragment URI.
        const chunkUris: string[] = chunks.map((_, i) =>
          chunks.length === 1 ? uri : `${uri}#chunk-${i}`
        );

        // Pre-compute embeddings for the batch.
        const vectors = await this.embedder.embed(chunks.map((c) => c.text));

        const insertChunk = this.store.db.prepare(
          `INSERT INTO chunks (source_id, kind, uri, body, meta_json, embedder_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const insertEmbedding = this.store.db.prepare(
          `INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`
        );

        const tx = this.store.db.transaction(() => {
          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const result = insertChunk.run(
              opts.sourceId,
              'text-document',
              chunkUris[i],
              c.text,
              JSON.stringify({ startChar: c.startChar, endChar: c.endChar }),
              this.embedder.id,
              Date.now()
            );
            const chunkId = BigInt(result.lastInsertRowid as bigint | number);
            insertEmbedding.run(chunkId, Buffer.from(vectors[i].buffer));
            totalChunks++;
          }
        });
        tx();

        indexedFiles++;
      } catch (e) {
        errors.push({
          path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { indexedFiles, chunks: totalChunks, errors };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test document-indexer
```

Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/indexer/document-indexer.ts __tests__/document-indexer.test.ts
git commit -m "feat(indexer): DocumentIndexer — walks fs, chunks, embeds, stores"
```

---

## Task 4: Hybrid SearchService

**Files:**
- Create: `src/search/service.ts`
- Test: `__tests__/search.test.ts`

Hybrid search: BM25 (FTS5 `MATCH`) + vector similarity (sqlite-vec `MATCH`), merged via reciprocal rank fusion (RRF). RRF is the standard combiner: `score = sum(1 / (k + rank))` with k=60.

- [ ] **Step 1: Write the failing test**

Create `__tests__/search.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, loadInitialMigrations } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { DocumentIndexer } from '../src/indexer/document-indexer.js';
import { SearchService } from '../src/search/service.js';
import type { EmbeddingProvider } from '../src/core/embedding-provider.js';

class DeterministicEmbedder implements EmbeddingProvider {
  readonly id = 'deterministic';
  readonly name = 'Deterministic';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    // Embedding strategy: vector hashes characters into dims so
    // texts with the same vocabulary cluster together.
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      for (const ch of t.toLowerCase()) {
        v[ch.charCodeAt(0) % this.dims] += 1;
      }
      // L2-normalise
      let n = 0;
      for (let i = 0; i < this.dims; i++) n += v[i] * v[i];
      n = Math.sqrt(n) || 1;
      for (let i = 0; i < this.dims; i++) v[i] /= n;
      return v;
    });
  }
  async probe() {
    return { ok: true as const, dims: this.dims };
  }
}

describe('SearchService', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'llm-wiki-search-test-'));
    writeFileSync(join(fixtureDir, 'apples.md'), 'Apples are red and tasty fruit.');
    writeFileSync(join(fixtureDir, 'oranges.md'), 'Oranges are orange and citrus fruit.');
    writeFileSync(join(fixtureDir, 'cars.md'), 'Cars are vehicles with four wheels.');
  });

  afterAll(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('finds keyword matches via BM25', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    await new DocumentIndexer({ store, embedder }).run({
      rootPath: fixtureDir,
      sourceId: 'fruits',
    });

    const service = new SearchService({ store, embedder });
    const results = await service.search('apples', { limit: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].body.toLowerCase()).toContain('apple');
    store.close();
  });

  it('returns at most `limit` results', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    await new DocumentIndexer({ store, embedder }).run({
      rootPath: fixtureDir,
      sourceId: 'fruits',
    });

    const service = new SearchService({ store, embedder });
    const results = await service.search('fruit', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
    store.close();
  });

  it('blends BM25 and vector ranks (RRF)', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    await new DocumentIndexer({ store, embedder }).run({
      rootPath: fixtureDir,
      sourceId: 'fruits',
    });

    const service = new SearchService({ store, embedder });
    const results = await service.search('citrus orange', { limit: 3 });
    expect(results[0].body.toLowerCase()).toContain('orange');
    store.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test search
```

Expected: FAIL — `search/service.js` not found.

- [ ] **Step 3: Implement the service**

Create `src/search/service.ts`:

```typescript
import type { Store } from '../storage/store.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';

export type SearchResult = {
  chunkId: number;
  sourceId: string;
  uri: string;
  body: string;
  score: number;
};

export type SearchOptions = {
  limit?: number;
};

export type SearchServiceOptions = {
  store: Store;
  embedder: EmbeddingProvider;
};

const RRF_K = 60;
const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 50;

export class SearchService {
  private readonly store: Store;
  private readonly embedder: EmbeddingProvider;

  constructor(options: SearchServiceOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
  }

  /**
   * Hybrid search:
   *  - FTS5 MATCH for keyword/BM25 ranking
   *  - sqlite-vec MATCH for vector similarity
   *  - merged via reciprocal rank fusion (RRF, k=60)
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;

    // BM25 rank (FTS5 returns negative bm25; lower is better → invert order)
    const ftsRows = this.store.db
      .prepare(
        `SELECT chunks.id AS chunk_id, chunks.source_id, chunks.uri, chunks.body
         FROM fts JOIN chunks ON chunks.id = fts.rowid
         WHERE fts MATCH ?
         ORDER BY bm25(fts)
         LIMIT ?`
      )
      .all(this.escapeFtsQuery(query), CANDIDATE_LIMIT) as {
        chunk_id: number;
        source_id: string;
        uri: string;
        body: string;
      }[];

    // Vector rank
    const [queryVec] = await this.embedder.embed([query]);
    const vecRows = this.store.db
      .prepare(
        `SELECT embeddings.chunk_id, chunks.source_id, chunks.uri, chunks.body, distance
         FROM embeddings JOIN chunks ON chunks.id = embeddings.chunk_id
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`
      )
      .all(Buffer.from(queryVec.buffer), CANDIDATE_LIMIT) as {
        chunk_id: number;
        source_id: string;
        uri: string;
        body: string;
        distance: number;
      }[];

    // RRF: score = sum(1 / (RRF_K + rank))
    const fusedScores = new Map<number, { score: number; row: { chunk_id: number; source_id: string; uri: string; body: string } }>();

    ftsRows.forEach((row, i) => {
      const rank = i + 1;
      const entry = fusedScores.get(row.chunk_id) ?? {
        score: 0,
        row: { chunk_id: row.chunk_id, source_id: row.source_id, uri: row.uri, body: row.body },
      };
      entry.score += 1 / (RRF_K + rank);
      fusedScores.set(row.chunk_id, entry);
    });

    vecRows.forEach((row, i) => {
      const rank = i + 1;
      const entry = fusedScores.get(row.chunk_id) ?? {
        score: 0,
        row: { chunk_id: row.chunk_id, source_id: row.source_id, uri: row.uri, body: row.body },
      };
      entry.score += 1 / (RRF_K + rank);
      fusedScores.set(row.chunk_id, entry);
    });

    return Array.from(fusedScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score, row }) => ({
        chunkId: row.chunk_id,
        sourceId: row.source_id,
        uri: row.uri,
        body: row.body,
        score,
      }));
  }

  /**
   * FTS5 has special characters that must be quoted to be treated as
   * literals. For v1 we simply quote the entire query as a phrase
   * (preserves all characters); accuracy gains from term-level escaping
   * can come in 3a.1 if needed.
   */
  private escapeFtsQuery(query: string): string {
    // Replace any double-quote with two double-quotes (FTS5 escape), then wrap.
    return `"${query.replace(/"/g, '""')}"`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test search
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/search/service.ts __tests__/search.test.ts
git commit -m "feat(search): hybrid BM25 + vector search via RRF fusion"
```

---

## Task 5: CLI commands — `--index <path>` and `--search "<query>"`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the two branches**

Insert near the existing `--embed` / `--storage-status` branches in `src/cli.ts`:

```typescript
if (args.includes('--index')) {
  const idx = args.indexOf('--index');
  const path = args[idx + 1];
  if (!path) {
    console.error('Usage: pnpm cli --index <path>');
    process.exit(1);
  }

  const { activeProfile } = await loadConfig({ profileOverride });
  const { openDefaultStore } = await import('./storage/store.js');
  const { DocumentIndexer } = await import('./indexer/document-indexer.js');

  const store = await openDefaultStore();
  const embedder = createEmbedder(activeProfile);
  const indexer = new DocumentIndexer({ store, embedder });

  const sourceId = `local:${path}`;
  console.log(`Indexing ${path} (source: ${sourceId})…`);
  const t0 = performance.now();
  const result = await indexer.run({ rootPath: path, sourceId });
  const ms = Math.round(performance.now() - t0);

  console.log(`indexed:  ${result.indexedFiles} files`);
  console.log(`chunks:   ${result.chunks}`);
  console.log(`time:     ${ms} ms`);
  if (result.errors.length > 0) {
    console.log(`errors:   ${result.errors.length}`);
    for (const err of result.errors.slice(0, 5)) {
      console.log(`  - ${err.path}: ${err.error}`);
    }
  }
  store.close();
  return;
}

if (args.includes('--search')) {
  const idx = args.indexOf('--search');
  const query = args[idx + 1];
  if (!query) {
    console.error('Usage: pnpm cli --search "<query>"');
    process.exit(1);
  }

  const { activeProfile } = await loadConfig({ profileOverride });
  const { openDefaultStore } = await import('./storage/store.js');
  const { SearchService } = await import('./search/service.js');

  const store = await openDefaultStore();
  const embedder = createEmbedder(activeProfile);
  const service = new SearchService({ store, embedder });

  const t0 = performance.now();
  const results = await service.search(query, { limit: 10 });
  const ms = Math.round(performance.now() - t0);

  console.log(`query:    ${query}`);
  console.log(`results:  ${results.length} (${ms} ms)`);
  console.log('');
  for (const r of results) {
    const snippet = r.body.length > 200 ? `${r.body.slice(0, 200)}…` : r.body;
    console.log(`[score ${r.score.toFixed(4)}] ${r.uri}`);
    console.log(`  ${snippet.replace(/\n/g, ' ')}`);
    console.log('');
  }
  store.close();
  return;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: all passing.

- [ ] **Step 4: End-to-end smoke (optional, requires real embedder)**

```bash
cd /Users/krunal/Development/llm-wiki
# Index this very repo's docs as a smoke target
pnpm cli --index docs/superpowers/

# Search for something we know is in there
pnpm cli --search "space-agent fork"
```

Expected: indexes a handful of files, search returns plan/spike findings with their text snippets. First run pays the embedder cold-start (~4.5s).

If the embedder fails on first run (network, model cache), report DONE_WITH_CONCERNS — the unit tests cover the wiring; the live smoke is a nice-to-have.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/cli.ts
git commit -m "feat(cli): --index <path> and --search \"<query>\""
```

---

## Task 6: README — Indexing + Search section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a section**

```markdown
## Indexing and search

`pnpm cli --index <path>` walks a directory recursively, chunks every `.md` / `.markdown` / `.txt` file (paragraph-aware, ~500 char target with 50 char overlap), embeds each chunk via the active profile's embedder, and stores everything in `~/.llm-wiki/index.sqlite` (Plan 1's schema).

`pnpm cli --search "<query>"` runs a hybrid search: FTS5 BM25 + sqlite-vec cosine, merged via reciprocal rank fusion (RRF, k=60). Returns the top 10 chunks with body snippets and source URIs.

\`\`\`bash
# Index a docs directory
pnpm cli --index docs/

# Search the indexed content
pnpm cli --search "config-driven LLM provider"

# Re-index — DocumentIndexer is idempotent. Existing chunks for the
# same (source_id, uri) are replaced; no duplicates.
pnpm cli --index docs/
\`\`\`

The first index of a directory pays the ONNX embedder cold-start (~4.5s). Subsequent calls in the same process are fast.

### What's indexed today (Plan 3a)

- Plain markdown / text files only. PDF and HTML support arrives in Plan 3b.
- Local filesystem source only. MCP-driven indexing arrives in Plan 3f.
- No code-aware chunking; that's Plan 3c.
- No cross-source link enrichment; that's Plan 3e.
```

(Replace escaped backticks with real triple-backticks.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: indexing and search sections"
```

---

## Spec coverage check

| Spec section | Implemented in (Plan 3a) | Deferred to |
| --- | --- | --- |
| §4 — `chunks` table populated | Tasks 3, 5 | — |
| §4 — `embeddings` table populated | Tasks 3, 5 | — |
| §4 — `fts` populated via triggers | Free with chunks insert (Plan 1 wired triggers) | — |
| §4 — Document indexer | Task 3 | — |
| §4 — Code indexer | — | Plan 3c |
| §4 — Ticket indexer | — | Plan 3d |
| §4 — Index orchestrator | — | Plan 3f |
| §4 — Cross-source link resolver | — | Plan 3e |
| §4 — Hybrid retrieval (BM25 + vector) | Task 4 (RRF fusion) | — |
| §5 — Capability verb routing | — | Plan 3g |

All Plan 3a deliverables traced; deferrals enumerated for downstream plans.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0
- [ ] Typecheck passes: `pnpm typecheck` exits 0
- [ ] `pnpm cli --index docs/superpowers/` succeeds, indexes ~10 files
- [ ] `pnpm cli --search "<some keyword from a plan>"` returns sensible results
- [ ] Re-running `pnpm cli --index docs/superpowers/` is idempotent (chunk count stays roughly stable, no errors)
- [ ] `git log --oneline` shows ~7 new commits (one per task 0–6)

---

*End of Plan 3a.*
