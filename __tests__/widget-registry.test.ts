import { describe, it, expect } from 'vitest';
import { WIDGET_REGISTRY, ALL_WIDGETS, pickWidgetForKind } from '../src/core/widget-registry.js';

describe('widget registry', () => {
  it('contains all expected widget mappings', () => {
    expect(WIDGET_REGISTRY['text-document'].shapeType).toBe('strata:markdown');
    expect(WIDGET_REGISTRY['wiki-page'].shapeType).toBe('strata:markdown');
    expect(WIDGET_REGISTRY['code-symbol'].shapeType).toBe('strata:code-block');
    expect(WIDGET_REGISTRY['code-file'].shapeType).toBe('strata:code-block');
    expect(WIDGET_REGISTRY['ticket'].shapeType).toBe('strata:ticket');
    expect(WIDGET_REGISTRY['web-page'].shapeType).toBe('strata:web-embed');
  });

  it('pickWidgetForKind returns a Widget for a known kind', () => {
    const w = pickWidgetForKind('ticket');
    expect(w.shapeType).toBe('strata:ticket');
    expect(w.acceptsKinds).toContain('ticket');
  });

  it('pickWidgetForKind returns the fallback for unknown kinds', () => {
    const w = pickWidgetForKind('image' as never);
    expect(w.shapeType).toBe('strata:key-value-card');
  });

  it('every widget id is unique', () => {
    // ALL_WIDGETS is the deduplicated list; WIDGET_REGISTRY maps 15 ResultKinds
    // to 5 widgets (many-to-one), so we check uniqueness over the deduplicated set.
    const ids = ALL_WIDGETS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
