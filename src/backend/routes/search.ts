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
      symbolName: typeof meta['symbolName'] === 'string' ? meta['symbolName'] : undefined,
      filePath: typeof meta['file'] === 'string' ? meta['file'] : titleFromUri(uri),
      language: typeof meta['language'] === 'string' ? meta['language'] : undefined,
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
