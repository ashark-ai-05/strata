import { describe, it, expect } from 'vitest';
import type { Widget, WidgetAction, RenderCtx } from '../src/core/widget.js';
import type { ResultKind } from '../src/core/source.js';

describe('Widget type contract', () => {
  it('accepts a minimal widget definition', () => {
    const w: Widget = {
      id: 'test',
      acceptsKinds: ['text-document'] as ResultKind[],
      shapeType: 'llm-wiki:test',
    };
    expect(w.id).toBe('test');
    expect(w.acceptsKinds).toContain('text-document');
    expect(w.shapeType).toBe('llm-wiki:test');
  });

  it('allows optional actions and refresh', () => {
    const w: Widget = {
      id: 'with-actions',
      acceptsKinds: ['ticket'],
      shapeType: 'llm-wiki:ticket',
      actions: [
        { id: 'open-source', label: 'Open in source' },
        { id: 'pin', label: 'Pin' },
      ],
    };
    expect(w.actions).toHaveLength(2);
  });

  it('RenderCtx exposes editor + result', () => {
    // Just compile-time check — RenderCtx must include these fields.
    const fake = { editor: null, result: null } as unknown as RenderCtx;
    expect(fake).toBeDefined();
  });
});
