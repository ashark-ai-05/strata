import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Tldraw, type Editor, type TLUiComponents } from 'tldraw';
import 'tldraw/tldraw.css';
import { TextNoteShapeUtil } from './shapes/text-note';
import { ToolsBridge } from './ToolsBridge';
import { CollapsibleStylePanel } from '../components/CollapsibleStylePanel';
import { CanvasGrid } from '../components/CanvasGrid';
import { CanvasMap } from '../components/CanvasMap';
import { useUiStore } from '../state/ui-store';
import { MarkdownShapeUtil } from './shapes/markdown';
import { CodeBlockShapeUtil } from './shapes/code-block';
import { TicketCardShapeUtil } from './shapes/ticket-card';
import { WebEmbedShapeUtil } from './shapes/web-embed';
import { KeyValueCardShapeUtil } from './shapes/key-value-card';
import { TableShapeUtil } from './shapes/table';
import { TimelineShapeUtil } from './shapes/timeline';
import { FileTreeShapeUtil } from './shapes/file-tree';
import { CompositeShapeUtil } from './shapes/composite';
import { TasksShapeUtil } from './shapes/tasks';
import { KanbanShapeUtil } from './shapes/kanban';
import { StickyNoteShapeUtil } from './shapes/sticky-note';
import { computeCanvasSnapshot } from './snapshot';
import { setLatestSnapshot } from '../state/snapshot-ref';
import { setEditor } from '../state/editor-ref';
import { useTemplateStore } from '../state/template-store';
import { useCanvasStats } from '../state/canvas-stats-store';
import { useConversationsStore } from '../state/conversations-store';
import { SearchBar } from '../components/SearchBar';
import { TemplatePicker } from '../components/TemplatePicker';
import { EmptyCanvasHint } from '../components/EmptyCanvasHint';

const customShapeUtils = [
  // Plan 4b — proof-of-wire (kept for backwards compat with saved canvases)
  TextNoteShapeUtil,
  // Plan 4c — real widget catalog
  MarkdownShapeUtil,
  CodeBlockShapeUtil,
  TicketCardShapeUtil,
  WebEmbedShapeUtil,
  KeyValueCardShapeUtil,
  // Phase 4 — extended kinds
  TableShapeUtil,
  TimelineShapeUtil,
  FileTreeShapeUtil,
  // Phase 5 — composite + interactive widgets
  CompositeShapeUtil,
  TasksShapeUtil,
  KanbanShapeUtil,
  StickyNoteShapeUtil,
];
const SAVE_DEBOUNCE_MS = 500;

export function Canvas() {
  // Bind to the active conversation. App.tsx re-mounts Canvas via key
  // when activeId changes, so we read once at mount.
  const { activeId, initialSnapshot } = useMemo(() => {
    const conv = useConversationsStore.getState().getActive();
    return { activeId: conv.id, initialSnapshot: conv.canvasSnapshot };
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      // Register the editor in a singleton so Chat (rendered outside the
      // Tldraw editor scope) can apply tool directives via getEditor().
      setEditor(editor);

      // Force dark color scheme — Strata is dark-only by design.
      editor.user.updateUserPreferences({ colorScheme: 'dark' });

      // Persist tldraw snapshot back into the active conversation. Source
      // filter is dropped — agent-initiated changes (place_widget) need to
      // save too. Debounce so rapid drag/resize events don't thrash.
      editor.store.listen(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          useConversationsStore
            .getState()
            .saveCanvasSnapshot(activeId, editor.getSnapshot());
        }, SAVE_DEBOUNCE_MS);
      });

      // Publish a canvas snapshot into the singleton ref so Chat (rendered
      // outside the Tldraw editor) can read live editor state on submit.
      const publishSnapshot = () => {
        const tplId = useTemplateStore.getState().activeTemplateId;
        const snap = computeCanvasSnapshot(editor, tplId);
        setLatestSnapshot(snap);
        useCanvasStats.getState().setWidgetCount(snap.widgets.length);
      };

      // Initial publish so the very first chat turn sees current canvas state.
      publishSnapshot();

      editor.store.listen(publishSnapshot);
    },
    [activeId]
  );

  // Capture-phase wheel listener that swallows scroll outside any
  // `.strata-card-body` when the user has the canvas locked. Lets folks
  // scroll inside a code-block / file-tree without the canvas zooming
  // out from under them.
  const wheelLocked = useUiStore((s) => s.canvasWheelLocked);
  useEffect(() => {
    if (!wheelLocked) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.strata-card-body')) return;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, [wheelLocked]);

  return (
    <div className="size-full" style={{ position: 'relative' }}>
      <CanvasGrid />
      <Tldraw
        shapeUtils={customShapeUtils}
        snapshot={initialSnapshot}
        onMount={handleMount}
        components={tldrawUiComponents}
      >
        <ToolsBridge />
        <SearchBar />
        <TemplatePicker />
        <EmptyCanvasHint />
      </Tldraw>
      <CanvasMap />
    </div>
  );
}

/**
 * Strip tldraw's built-in chrome — Strata renders its own header
 * controls. The CollapsibleStylePanel replaces tldraw's StylePanel so
 * the right edge stays clear when nothing's selected.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `Canvas.tsx`.
 */
const tldrawUiComponents: TLUiComponents = {
  MainMenu: null,
  MenuPanel: null,
  PageMenu: null,
  NavigationPanel: null,
  ZoomMenu: null,
  Minimap: null,
  SharePanel: null,
  TopPanel: null,
  DebugMenu: null,
  DebugPanel: null,
  HelpMenu: null,
  Toolbar: null,
  QuickActions: null,
  HelperButtons: null,
  StylePanel: CollapsibleStylePanel,
};
