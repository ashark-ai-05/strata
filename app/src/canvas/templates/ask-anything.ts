import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

const COL_GAP = 60;
const ROW_GAP = 20;

const askAnythingLayout: TemplateLayout = (results, viewport) => {
  const placements: ShapePlacement[] = [];
  if (results.length === 0) return placements;

  const originX = viewport.x + 80;
  const originY = viewport.y + 100;

  // Group by kind, preserving result order within each group.
  const byKind = new Map<string, typeof results>();
  for (const r of results) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }

  let col = 0;
  for (const [, group] of byKind) {
    const widget = pickWidgetForKind(group[0].kind);
    const size = DEFAULT_SIZES[widget.shapeType] ?? { w: 320, h: 200 };
    let row = 0;
    for (const r of group) {
      placements.push({
        shapeType: widget.shapeType,
        x: originX + col * (size.w + COL_GAP),
        y: originY + row * (size.h + ROW_GAP),
        props: shapeProps(widget.shapeType, r, size),
      });
      row++;
    }
    col++;
  }

  return placements;
};

export const ASK_ANYTHING_TEMPLATE: CanvasTemplate = {
  id: 'ask-anything',
  name: 'Ask anything',
  layout: askAnythingLayout,
};
