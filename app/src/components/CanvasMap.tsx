import { useEffect, useState } from 'react';
import { Compass } from 'lucide-react';
import { getEditor } from '../state/editor-ref';
import { useCanvasStats } from '../state/canvas-stats-store';

/**
 * Bottom-left mini-map / overview button. Hidden when the canvas is
 * empty (no strata widgets). Click → "fit all widgets" via tldraw's
 * `zoomToFit`. The actual minimap thumbnail rendering is intentionally
 * skipped — it would need a second tldraw editor instance and adds
 * little value at this scale.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `CanvasMap`.
 */
export function CanvasMap() {
  const widgetCount = useCanvasStats((s) => s.widgetCount);
  // Mount delay: avoid flashing in for a single frame before the canvas
  // hydrates. The 200ms threshold is shorter than a useChat first-paint.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 200);
    return () => clearTimeout(t);
  }, []);

  if (!ready || widgetCount === 0) return null;

  return (
    <button
      type="button"
      title={`Fit all ${widgetCount} widget${widgetCount === 1 ? '' : 's'}`}
      aria-label="Fit canvas to widgets"
      className="strata-canvas-map"
      onClick={() => {
        const editor = getEditor();
        if (!editor) return;
        editor.zoomToFit({ animation: { duration: 220 } });
      }}
    >
      <Compass className="size-3.5" />
      <span>{widgetCount}</span>
    </button>
  );
}
