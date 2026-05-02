import type { Editor } from 'tldraw';
import type { SearchResult } from '../api/search';
import { TEMPLATES_BY_ID } from './templates';
import { useTemplateStore } from '../state/template-store';

/**
 * Place results on the canvas using the active template's layout.
 * The layout function returns ShapePlacement[]; we hand each one to
 * editor.createShape.
 */
export function placeResultsOnCanvas(
  editor: Editor,
  results: SearchResult[]
): void {
  if (results.length === 0) return;

  const { activeTemplateId } = useTemplateStore.getState();
  const template = TEMPLATES_BY_ID[activeTemplateId];
  const placements = template.layout(results, editor.getViewportPageBounds());

  for (const p of placements) {
    editor.createShape({
      type: p.shapeType,
      x: p.x,
      y: p.y,
      props: p.props,
    });
  }
}
