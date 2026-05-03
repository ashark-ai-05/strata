import { describe, it, expect } from 'vitest';
import { placeWidgetTool } from '../../../src/agent/tools/place-widget.js';

describe('place_widget', () => {
  it('returns ok=true with a generated id and a place directive', async () => {
    const handler = placeWidgetTool().handler;
    const r = await handler(
      {
        kind: 'markdown',
        role: 'primary',
        payload: { title: 'auth', body: 'overview' },
      },
      undefined,
    );
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(typeof out.id).toBe('string');
    expect(out.id.length).toBeGreaterThan(0);
    expect(out.directive).toEqual({
      type: 'place',
      id: out.id,
      kind: 'markdown',
      role: 'primary',
      payload: { title: 'auth', body: 'overview' },
    });
  });

  it('rejects malformed payload for the chosen kind', async () => {
    const handler = placeWidgetTool().handler;
    const r = await handler(
      {
        kind: 'web-embed',
        role: 'reference',
        payload: { title: 'docs', url: 'not-a-url' },
      },
      undefined,
    );
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('Invalid payload');
  });

  it('rejects unknown kind', async () => {
    const handler = placeWidgetTool().handler;
    // @ts-expect-error testing runtime guard
    const r = await handler({ kind: 'made-up-kind', role: 'primary', payload: {} }, undefined);
    expect(r.isError).toBe(true);
  });

  it('mints a unique id per call', async () => {
    const handler = placeWidgetTool().handler;
    const a = JSON.parse(
      (await handler(
        { kind: 'markdown', role: 'primary', payload: { title: 't', body: 'b' } },
        undefined,
      )).content[0]!.text!,
    );
    const b = JSON.parse(
      (await handler(
        { kind: 'markdown', role: 'primary', payload: { title: 't', body: 'b' } },
        undefined,
      )).content[0]!.text!,
    );
    expect(a.id).not.toBe(b.id);
  });
});
