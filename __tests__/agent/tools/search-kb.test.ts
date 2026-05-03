import { describe, it, expect, vi } from 'vitest';
import { searchKbTool } from '../../../src/agent/tools/search-kb.js';

const fakeSearchService = (results: unknown[]) => ({
  search: vi.fn().mockResolvedValue(results),
});

describe('search_kb', () => {
  it('returns summary-only results (no full payloads)', async () => {
    const svc = fakeSearchService([
      {
        id: 'docs:auth',
        kind: 'text-document',
        title: 'auth overview',
        snippet: 'JWT...',
        score: 0.92,
        source: 'docs',
        payload: { body: 'a long body that should not be returned' },
      },
    ]);
    const handler = searchKbTool(svc as never).handler;
    const r = await handler({ query: 'auth' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).not.toHaveProperty('payload');
    expect(out.results[0]).toEqual({
      id: 'docs:auth',
      kind: 'text-document',
      title: 'auth overview',
      snippet: 'JWT...',
      score: 0.92,
      source: 'docs',
    });
  });

  it('clamps limit to 25', async () => {
    const svc = fakeSearchService([]);
    const handler = searchKbTool(svc as never).handler;
    await handler({ query: 'x', limit: 999 }, undefined);
    expect(svc.search).toHaveBeenCalledWith('x', 25);
  });

  it('defaults limit to 10', async () => {
    const svc = fakeSearchService([]);
    const handler = searchKbTool(svc as never).handler;
    await handler({ query: 'x' }, undefined);
    expect(svc.search).toHaveBeenCalledWith('x', 10);
  });

  it('returns warning when search throws "index not ready"', async () => {
    const svc = {
      search: vi.fn().mockRejectedValue(new Error('index not ready')),
    };
    const handler = searchKbTool(svc as never).handler;
    const r = await handler({ query: 'x' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.results).toEqual([]);
    expect(out.warning).toContain('index');
  });
});
