# Plan 4c — Widget Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the proof-of-wire `TextNoteShape` with five real widgets from spec §3 — `MarkdownWidget`, `CodeBlockWidget`, `TicketCardWidget`, `WebEmbedWidget`, `KeyValueCardWidget` — register them in the canvas, and add a debug toolbar with one button per widget type that creates an example shape for visual testing.

**Architecture:** Each widget is a tldraw `ShapeUtil` under `app/src/canvas/shapes/<kind>.tsx`. They share a lightweight base style (dark card, rounded corner, padding) and differ in their `component()` rendering. A registry at `src/core/widget-registry.ts` maps `ResultKind` → `Widget` (by `shapeType`); Plan 4d uses this to dispatch agent output. The debug toolbar `app/src/components/DebugToolbar.tsx` uses `useEditor()` to create example shapes — proves the registration works without needing the full result-dispatcher yet.

**Tech Stack additions:** `react-markdown` for markdown rendering. No syntax-highlighting library in this plan — code is rendered as monospace plain text in a styled block. Highlighting is a follow-up (Plan 4c.1 if wanted).

**References:**
- Plan 4b: `docs/superpowers/plans/2026-05-03-plan-4b-canvas-and-widget-abstraction.md` — `Widget` interface + canvas + persistence
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §3 (full widget catalog with `acceptsKinds` mappings)

**Out of scope:**
- Result dispatcher routing agent output → widgets (Plan 4d)
- Canvas templates with zone-based layout (Plan 4e)
- Syntax highlighting (Plan 4c.1 if wanted)
- Live tail / refresh for `log-stream` and `metric-series` widgets — those are spec §3 too but live data sources arrive in Plan 4d/3f
- TableWidget, MetricChartWidget, ChatMessageWidget, RunbookWidget, DashboardEmbedWidget, K8sResourceWidget, LogTimelineWidget — defer to Plan 4c.1+ (per-widget cost is small but bundle size matters)

The five widgets in this plan cover the most common Result shapes from indexer + MCP demo source.

---

## File structure

### New files

```
src/core/
  widget-registry.ts                         # ResultKind → Widget map
app/src/canvas/shapes/
  markdown.tsx                               # MarkdownWidget — text-document, wiki-page
  code-block.tsx                             # CodeBlockWidget — code-symbol, code-file
  ticket-card.tsx                            # TicketCardWidget — ticket
  web-embed.tsx                              # WebEmbedWidget — web-page
  key-value-card.tsx                         # KeyValueCardWidget — fallback
  shared.tsx                                 # shared card frame component + style helpers
app/src/components/
  DebugToolbar.tsx                           # buttons that create example shapes
__tests__/
  widget-registry.test.ts                    # ResultKind → shapeType mapping correctness
  app/
    markdown-shape.test.tsx
    code-block-shape.test.tsx
    ticket-card-shape.test.tsx
    key-value-card-shape.test.tsx
```

### Modified files

```
app/src/canvas/Canvas.tsx                    # register all 5 shape utils
app/src/App.tsx                              # mount DebugToolbar above the canvas
package.json                                 # add react-markdown
README.md                                    # widget catalog section
```

### Files explicitly NOT touched

`src/providers/`, `src/embedders/`, `src/storage/`, `src/mcp/`, `src/indexer/`, `src/search/`, `src/backend/`, `src/cli.ts`, `src/core/widget.ts` — backend stays unchanged. Plan 4b's `TextNoteShape` and `Widget` interface stay stable. (TextNoteShape gets retired only when the registry references the new shapes; we leave it registered for now in case anyone has saved canvases referencing it.)

---

## Task 0: Add `react-markdown` and shared shape style helpers

**Files:**
- Modify: `package.json`
- Create: `app/src/canvas/shapes/shared.tsx`

- [ ] **Step 1: Add dep**

Edit `package.json` `dependencies`:

```json
"react-markdown": "^10.0.0",
"remark-gfm": "^4.0.0"
```

If `^10.0.0` doesn't resolve, use `*`. `remark-gfm` enables GitHub-flavoured markdown (tables, strikethrough, autolinks).

- [ ] **Step 2: Install**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm install
```

- [ ] **Step 3: Create shared card frame**

Create `app/src/canvas/shapes/shared.tsx`:

```typescript
import type { CSSProperties, ReactNode } from 'react';

export const cardFrame: CSSProperties = {
  background: '#18181b',
  color: '#fafafa',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 13,
  pointerEvents: 'all',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

export const cardHeader: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #27272a',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

export const cardBody: CSSProperties = {
  padding: '10px 12px',
  flex: 1,
  overflow: 'auto',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
};

export const monoBody: CSSProperties = {
  ...cardBody,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  background: '#0a0a0a',
};

export const tag: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 4,
  background: '#27272a',
  color: '#a1a1aa',
};

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontWeight: 600, color: '#fafafa', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Verify nothing regressed**

```bash
cd /Users/krunal/Development/llm-wiki
pnpm test 2>&1 | tail -3
pnpm typecheck 2>&1 | tail -3
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add package.json pnpm-lock.yaml app/src/canvas/shapes/shared.tsx
git commit -m "chore(app): add react-markdown + shared card frame for widgets"
```

---

## Task 1: MarkdownWidget

**Files:**
- Create: `app/src/canvas/shapes/markdown.tsx`
- Create: `__tests__/app/markdown-shape.test.tsx`

Renders markdown with GFM. Accepts `text-document` and `wiki-page` result kinds.

- [ ] **Step 1: Implement**

Create `app/src/canvas/shapes/markdown.tsx`:

```typescript
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cardBody, cardFrame, cardHeader, CardTitle, tag } from './shared';

export type MarkdownShape = TLBaseShape<
  'llm-wiki:markdown',
  {
    w: number;
    h: number;
    title?: string;
    body: string;
    uri?: string;
  }
>;

export class MarkdownShapeUtil extends ShapeUtil<MarkdownShape> {
  static override type = 'llm-wiki:markdown' as const;

  static override props: RecordProps<MarkdownShape> = {
    w: T.number,
    h: T.number,
    title: T.optional(T.string),
    body: T.string,
    uri: T.optional(T.string),
  };

  override getDefaultProps(): MarkdownShape['props'] {
    return { w: 360, h: 220, body: '' };
  }

  override getGeometry(shape: MarkdownShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: MarkdownShape) {
    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{shape.props.title ?? 'Document'}</CardTitle>
          <span style={tag}>md</span>
        </div>
        <div style={cardBody}>
          <div className="llm-wiki-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{shape.props.body}</ReactMarkdown>
          </div>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: MarkdownShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
```

- [ ] **Step 2: Test**

Create `__tests__/app/markdown-shape.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { MarkdownShapeUtil } from '../../app/src/canvas/shapes/markdown';

describe('MarkdownShapeUtil', () => {
  it('declares the namespaced shape type', () => {
    expect(MarkdownShapeUtil.type).toBe('llm-wiki:markdown');
  });

  it('declares the typed props schema', () => {
    expect(MarkdownShapeUtil.props.w).toBeDefined();
    expect(MarkdownShapeUtil.props.h).toBeDefined();
    expect(MarkdownShapeUtil.props.body).toBeDefined();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/markdown-shape.test.tsx
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/shapes/markdown.tsx __tests__/app/markdown-shape.test.tsx
git commit -m "feat(app): MarkdownWidget — text-document/wiki-page rendering"
```

---

## Task 2: CodeBlockWidget

**Files:**
- Create: `app/src/canvas/shapes/code-block.tsx`
- Create: `__tests__/app/code-block-shape.test.tsx`

Renders code in a monospace block with file/symbol metadata. No syntax highlighting in v1 (deferred — see plan header).

- [ ] **Step 1: Implement**

Create `app/src/canvas/shapes/code-block.tsx`:

```typescript
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardFrame, cardHeader, CardTitle, monoBody, tag } from './shared';

export type CodeBlockShape = TLBaseShape<
  'llm-wiki:code-block',
  {
    w: number;
    h: number;
    language?: string;
    symbolName?: string;
    filePath?: string;
    body: string;
    uri?: string;
  }
>;

export class CodeBlockShapeUtil extends ShapeUtil<CodeBlockShape> {
  static override type = 'llm-wiki:code-block' as const;

  static override props: RecordProps<CodeBlockShape> = {
    w: T.number,
    h: T.number,
    language: T.optional(T.string),
    symbolName: T.optional(T.string),
    filePath: T.optional(T.string),
    body: T.string,
    uri: T.optional(T.string),
  };

  override getDefaultProps(): CodeBlockShape['props'] {
    return { w: 480, h: 280, body: '' };
  }

  override getGeometry(shape: CodeBlockShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: CodeBlockShape) {
    const titleParts: string[] = [];
    if (shape.props.symbolName) titleParts.push(shape.props.symbolName);
    if (shape.props.filePath) titleParts.push(shape.props.filePath);
    const title = titleParts.join(' · ') || 'Code';

    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{title}</CardTitle>
          {shape.props.language && <span style={tag}>{shape.props.language}</span>}
        </div>
        <pre style={{ ...monoBody, margin: 0 }}>{shape.props.body}</pre>
      </HTMLContainer>
    );
  }

  override indicator(shape: CodeBlockShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
```

- [ ] **Step 2: Test**

Create `__tests__/app/code-block-shape.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { CodeBlockShapeUtil } from '../../app/src/canvas/shapes/code-block';

describe('CodeBlockShapeUtil', () => {
  it('declares llm-wiki:code-block', () => {
    expect(CodeBlockShapeUtil.type).toBe('llm-wiki:code-block');
  });

  it('exposes language, symbolName, filePath, body in props', () => {
    expect(CodeBlockShapeUtil.props.language).toBeDefined();
    expect(CodeBlockShapeUtil.props.symbolName).toBeDefined();
    expect(CodeBlockShapeUtil.props.filePath).toBeDefined();
    expect(CodeBlockShapeUtil.props.body).toBeDefined();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/code-block-shape.test.tsx
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/shapes/code-block.tsx __tests__/app/code-block-shape.test.tsx
git commit -m "feat(app): CodeBlockWidget — code-symbol/code-file rendering"
```

---

## Task 3: TicketCardWidget

**Files:**
- Create: `app/src/canvas/shapes/ticket-card.tsx`
- Create: `__tests__/app/ticket-card-shape.test.tsx`

Renders a Jira-style ticket card with status pill + assignee + description.

- [ ] **Step 1: Implement**

Create `app/src/canvas/shapes/ticket-card.tsx`:

```typescript
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardBody, cardFrame, cardHeader, CardTitle, tag } from './shared';

export type TicketCardShape = TLBaseShape<
  'llm-wiki:ticket',
  {
    w: number;
    h: number;
    ticketId: string;
    title: string;
    status?: string;
    assignee?: string;
    description?: string;
    uri?: string;
  }
>;

const STATUS_COLOR: Record<string, string> = {
  todo: '#71717a',
  'in-progress': '#f59e0b',
  done: '#22c55e',
  blocked: '#ef4444',
};

export class TicketCardShapeUtil extends ShapeUtil<TicketCardShape> {
  static override type = 'llm-wiki:ticket' as const;

  static override props: RecordProps<TicketCardShape> = {
    w: T.number,
    h: T.number,
    ticketId: T.string,
    title: T.string,
    status: T.optional(T.string),
    assignee: T.optional(T.string),
    description: T.optional(T.string),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): TicketCardShape['props'] {
    return {
      w: 320,
      h: 200,
      ticketId: 'TICKET-?',
      title: 'Untitled ticket',
    };
  }

  override getGeometry(shape: TicketCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TicketCardShape) {
    const color = shape.props.status ? STATUS_COLOR[shape.props.status] ?? '#71717a' : '#71717a';
    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <span style={{ ...tag, fontFamily: 'ui-monospace, monospace' }}>{shape.props.ticketId}</span>
          <CardTitle>{shape.props.title}</CardTitle>
          {shape.props.status && (
            <span style={{ ...tag, background: color, color: '#0a0a0a' }}>{shape.props.status}</span>
          )}
        </div>
        <div style={cardBody}>
          {shape.props.assignee && (
            <div style={{ marginBottom: 8, color: '#a1a1aa' }}>
              <span style={{ color: '#71717a' }}>assignee: </span>
              {shape.props.assignee}
            </div>
          )}
          {shape.props.description && (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {shape.props.description}
            </div>
          )}
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: TicketCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
```

- [ ] **Step 2: Test**

Create `__tests__/app/ticket-card-shape.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { TicketCardShapeUtil } from '../../app/src/canvas/shapes/ticket-card';

describe('TicketCardShapeUtil', () => {
  it('declares llm-wiki:ticket', () => {
    expect(TicketCardShapeUtil.type).toBe('llm-wiki:ticket');
  });

  it('requires ticketId and title', () => {
    expect(TicketCardShapeUtil.props.ticketId).toBeDefined();
    expect(TicketCardShapeUtil.props.title).toBeDefined();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/ticket-card-shape.test.tsx
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/shapes/ticket-card.tsx __tests__/app/ticket-card-shape.test.tsx
git commit -m "feat(app): TicketCardWidget — Jira-style ticket card with status pill"
```

---

## Task 4: WebEmbedWidget

**Files:**
- Create: `app/src/canvas/shapes/web-embed.tsx`

Renders a sandboxed iframe with a header showing the URL. Plan-spec note: per design §3, the WebEmbedWidget is "sandboxed iframe with origin allowlist" — for v1 we sandbox via the iframe `sandbox` attribute and rely on browser same-origin defaults. Origin allowlist (Plan 4c.2 if needed) is a future hardening pass.

- [ ] **Step 1: Implement**

Create `app/src/canvas/shapes/web-embed.tsx`:

```typescript
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardFrame, cardHeader, CardTitle, tag } from './shared';

export type WebEmbedShape = TLBaseShape<
  'llm-wiki:web-embed',
  {
    w: number;
    h: number;
    url: string;
    title?: string;
  }
>;

export class WebEmbedShapeUtil extends ShapeUtil<WebEmbedShape> {
  static override type = 'llm-wiki:web-embed' as const;

  static override props: RecordProps<WebEmbedShape> = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.optional(T.string),
  };

  override getDefaultProps(): WebEmbedShape['props'] {
    return { w: 480, h: 320, url: 'about:blank' };
  }

  override getGeometry(shape: WebEmbedShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: WebEmbedShape) {
    let host: string;
    try {
      host = new URL(shape.props.url).host || shape.props.url;
    } catch {
      host = shape.props.url;
    }
    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{shape.props.title ?? host}</CardTitle>
          <span style={tag}>web</span>
        </div>
        <iframe
          src={shape.props.url}
          // sandbox restricts the iframe; allow scripts + same-origin off so
          // arbitrary web pages don't get our cookies. Add allow-popups
          // selectively if a use case demands it later.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{
            border: 'none',
            width: '100%',
            height: '100%',
            background: '#0a0a0a',
            flex: 1,
          }}
          title={shape.props.title ?? host}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: WebEmbedShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
```

- [ ] **Step 2: Commit (no separate test — iframe behaviour is best smoke-tested visually)**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/shapes/web-embed.tsx
git commit -m "feat(app): WebEmbedWidget — sandboxed iframe for web-page kind"
```

---

## Task 5: KeyValueCardWidget

**Files:**
- Create: `app/src/canvas/shapes/key-value-card.tsx`
- Create: `__tests__/app/key-value-card-shape.test.tsx`

The fallback widget — used when the dispatcher (Plan 4d) sees a `Result.kind` it doesn't have a specialized widget for. Renders a title + a list of key/value pairs.

- [ ] **Step 1: Implement**

Create `app/src/canvas/shapes/key-value-card.tsx`:

```typescript
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardBody, cardFrame, cardHeader, CardTitle, tag } from './shared';

type KeyValuePair = { key: string; value: string };

export type KeyValueCardShape = TLBaseShape<
  'llm-wiki:key-value-card',
  {
    w: number;
    h: number;
    title: string;
    pairs: KeyValuePair[];
    uri?: string;
  }
>;

export class KeyValueCardShapeUtil extends ShapeUtil<KeyValueCardShape> {
  static override type = 'llm-wiki:key-value-card' as const;

  static override props: RecordProps<KeyValueCardShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    pairs: T.arrayOf(T.object({ key: T.string, value: T.string })),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): KeyValueCardShape['props'] {
    return { w: 320, h: 180, title: 'Untitled', pairs: [] };
  }

  override getGeometry(shape: KeyValueCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: KeyValueCardShape) {
    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <CardTitle>{shape.props.title}</CardTitle>
          <span style={tag}>data</span>
        </div>
        <div style={cardBody}>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            {shape.props.pairs.map((p, i) => (
              <FragmentRow key={i} k={p.key} v={p.value} />
            ))}
          </dl>
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: KeyValueCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: '#71717a', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{k}</dt>
      <dd style={{ margin: 0, color: '#fafafa', wordBreak: 'break-word' }}>{v}</dd>
    </>
  );
}
```

If `T.arrayOf` and `T.object` aren't named exactly that in the installed tldraw, check `node_modules/tldraw/dist/types/...` for the validator helpers and adapt. tldraw 3.x exports `T.arrayOf`, `T.object`, `T.string`, `T.number`, `T.optional` — these are stable.

- [ ] **Step 2: Test**

Create `__tests__/app/key-value-card-shape.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { KeyValueCardShapeUtil } from '../../app/src/canvas/shapes/key-value-card';

describe('KeyValueCardShapeUtil', () => {
  it('declares llm-wiki:key-value-card', () => {
    expect(KeyValueCardShapeUtil.type).toBe('llm-wiki:key-value-card');
  });

  it('declares pairs as an array prop', () => {
    expect(KeyValueCardShapeUtil.props.pairs).toBeDefined();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/key-value-card-shape.test.tsx
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/shapes/key-value-card.tsx __tests__/app/key-value-card-shape.test.tsx
git commit -m "feat(app): KeyValueCardWidget — fallback for unrecognized result kinds"
```

---

## Task 6: Widget registry — `ResultKind` → `Widget`

**Files:**
- Create: `src/core/widget-registry.ts`
- Create: `__tests__/widget-registry.test.ts`

The registry maps each `ResultKind` from spec §3 to the `shapeType` of the widget that should render it. Plan 4d's dispatcher consumes this to pick the right widget for each Result.

- [ ] **Step 1: Write the failing test**

Create `__tests__/widget-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WIDGET_REGISTRY, pickWidgetForKind } from '../src/core/widget-registry.js';

describe('widget registry', () => {
  it('contains all expected widget mappings', () => {
    expect(WIDGET_REGISTRY['text-document'].shapeType).toBe('llm-wiki:markdown');
    expect(WIDGET_REGISTRY['wiki-page'].shapeType).toBe('llm-wiki:markdown');
    expect(WIDGET_REGISTRY['code-symbol'].shapeType).toBe('llm-wiki:code-block');
    expect(WIDGET_REGISTRY['code-file'].shapeType).toBe('llm-wiki:code-block');
    expect(WIDGET_REGISTRY['ticket'].shapeType).toBe('llm-wiki:ticket');
    expect(WIDGET_REGISTRY['web-page'].shapeType).toBe('llm-wiki:web-embed');
  });

  it('pickWidgetForKind returns a Widget for a known kind', () => {
    const w = pickWidgetForKind('ticket');
    expect(w.shapeType).toBe('llm-wiki:ticket');
    expect(w.acceptsKinds).toContain('ticket');
  });

  it('pickWidgetForKind returns the fallback for unknown kinds', () => {
    const w = pickWidgetForKind('image' as never);
    expect(w.shapeType).toBe('llm-wiki:key-value-card');
  });

  it('every widget id is unique', () => {
    const ids = Object.values(WIDGET_REGISTRY).map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Implement**

Create `src/core/widget-registry.ts`:

```typescript
import type { ResultKind } from './source.js';
import type { Widget } from './widget.js';

const MARKDOWN: Widget = {
  id: 'markdown',
  acceptsKinds: ['text-document', 'wiki-page'],
  shapeType: 'llm-wiki:markdown',
};
const CODE_BLOCK: Widget = {
  id: 'code-block',
  acceptsKinds: ['code-symbol', 'code-file'],
  shapeType: 'llm-wiki:code-block',
};
const TICKET: Widget = {
  id: 'ticket',
  acceptsKinds: ['ticket'],
  shapeType: 'llm-wiki:ticket',
};
const WEB_EMBED: Widget = {
  id: 'web-embed',
  acceptsKinds: ['web-page'],
  shapeType: 'llm-wiki:web-embed',
};
const KEY_VALUE_CARD: Widget = {
  id: 'key-value-card',
  // Fallback — accepts every kind that doesn't have a specific widget.
  // The dispatcher (Plan 4d) treats this as the "no match" branch.
  acceptsKinds: [
    'image',
    'table-row-set',
    'metric-series',
    'chat-message',
    'runbook',
    'dashboard-embed',
    'log-stream',
    'k8s-resource',
    'code-diff',
  ],
  shapeType: 'llm-wiki:key-value-card',
};

/**
 * Static map from ResultKind → Widget. Plan 4d's dispatcher uses this to
 * pick which custom shape to instantiate when an agent returns a Result.
 *
 * Each entry must have a corresponding ShapeUtil registered in the
 * canvas's customShapeUtils array (app/src/canvas/Canvas.tsx).
 */
export const WIDGET_REGISTRY: Record<ResultKind, Widget> = {
  'text-document': MARKDOWN,
  'wiki-page': MARKDOWN,
  'code-symbol': CODE_BLOCK,
  'code-file': CODE_BLOCK,
  'code-diff': KEY_VALUE_CARD,
  ticket: TICKET,
  'log-stream': KEY_VALUE_CARD,
  'k8s-resource': KEY_VALUE_CARD,
  'web-page': WEB_EMBED,
  image: KEY_VALUE_CARD,
  'table-row-set': KEY_VALUE_CARD,
  'metric-series': KEY_VALUE_CARD,
  'chat-message': KEY_VALUE_CARD,
  runbook: KEY_VALUE_CARD,
  'dashboard-embed': KEY_VALUE_CARD,
};

/**
 * Pick a widget for a given ResultKind. Returns the fallback (KeyValueCard)
 * for kinds that aren't in the registry — protects future kinds added to
 * spec §3 from breaking the dispatcher before their widget ships.
 */
export function pickWidgetForKind(kind: ResultKind): Widget {
  return WIDGET_REGISTRY[kind] ?? KEY_VALUE_CARD;
}
```

- [ ] **Step 3: Run the test**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test widget-registry
```

Expected: PASS, all 4 tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/core/widget-registry.ts __tests__/widget-registry.test.ts
git commit -m "feat(core): widget registry — ResultKind → Widget map with fallback"
```

---

## Task 7: Register all shapes in Canvas

**Files:**
- Modify: `app/src/canvas/Canvas.tsx`

- [ ] **Step 1: Update Canvas.tsx**

Read the current `app/src/canvas/Canvas.tsx`, then replace the `customShapeUtils` line + add imports. The full updated imports block:

```typescript
import { useCallback, useMemo, useRef } from 'react';
import { Tldraw, type Editor, type TLEditorSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';
import { TextNoteShapeUtil } from './shapes/text-note';
import { MarkdownShapeUtil } from './shapes/markdown';
import { CodeBlockShapeUtil } from './shapes/code-block';
import { TicketCardShapeUtil } from './shapes/ticket-card';
import { WebEmbedShapeUtil } from './shapes/web-embed';
import { KeyValueCardShapeUtil } from './shapes/key-value-card';
import {
  loadCanvasSnapshot,
  saveCanvasSnapshot,
} from './persistence';
```

And update the customShapeUtils array:

```typescript
const customShapeUtils = [
  // Plan 4b — proof-of-wire (kept for backwards compat with saved canvases)
  TextNoteShapeUtil,
  // Plan 4c — real widget catalog
  MarkdownShapeUtil,
  CodeBlockShapeUtil,
  TicketCardShapeUtil,
  WebEmbedShapeUtil,
  KeyValueCardShapeUtil,
];
```

The rest of the file (handleMount, JSX) is unchanged.

- [ ] **Step 2: Verify build**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm app:build
```

Expected: exit 0. Build size will increase a bit (markdown deps + 5 more shapes).

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/Canvas.tsx
git commit -m "feat(app): register all 5 widget shapes in Canvas"
```

---

## Task 8: Debug toolbar with create-widget buttons

**Files:**
- Create: `app/src/components/DebugToolbar.tsx`
- Modify: `app/src/App.tsx`

This is the visual smoke-test surface — one button per widget that creates an example shape on the canvas. Lets you (and any future tester) confirm each widget renders correctly without needing the full result-dispatcher (Plan 4d).

- [ ] **Step 1: Implement**

Create `app/src/components/DebugToolbar.tsx`:

```typescript
import { useEditor } from 'tldraw';

const SAMPLE_MARKDOWN = `# Auth architecture

JWT tokens issued by **auth-svc**. See [TICKET-101](#).

- Access token: 1h
- Refresh token: 30d
- JWKS cache: 24h

| field | type |
| --- | --- |
| sub | string |
| exp | number |
`.trim();

const SAMPLE_CODE = `export async function processPayment(
  order: Order,
  card: Card,
): Promise<PaymentResult> {
  const charge = await chargeService.charge(card, order.totalCents);
  if (!charge.ok) {
    return { ok: false, error: charge.error };
  }
  return { ok: true, paymentId: charge.id };
}
`.trim();

export function DebugToolbar() {
  const editor = useEditor();

  const create = (type: string, props: Record<string, unknown>) => {
    // Place the new shape near the camera centre.
    const camera = editor.getCamera();
    const viewport = editor.getViewportPageBounds();
    editor.createShape({
      type,
      x: viewport.x + 80,
      y: viewport.y + 80,
      props,
    });
    void camera; // Acknowledge unused — kept for future positioning logic
  };

  const buttons: Array<{ label: string; onClick: () => void }> = [
    {
      label: 'Markdown',
      onClick: () =>
        create('llm-wiki:markdown', {
          w: 360,
          h: 240,
          title: 'Auth architecture',
          body: SAMPLE_MARKDOWN,
          uri: 'demo://auth-architecture',
        }),
    },
    {
      label: 'Code',
      onClick: () =>
        create('llm-wiki:code-block', {
          w: 480,
          h: 280,
          language: 'typescript',
          symbolName: 'processPayment',
          filePath: 'src/payments/process.ts',
          body: SAMPLE_CODE,
          uri: 'file://src/payments/process.ts#processPayment',
        }),
    },
    {
      label: 'Ticket',
      onClick: () =>
        create('llm-wiki:ticket', {
          w: 320,
          h: 200,
          ticketId: 'TICKET-101',
          title: 'Add OAuth support to login flow',
          status: 'in-progress',
          assignee: 'alice',
          description: 'OAuth via Google + GitHub. Spec in auth-architecture.',
          uri: 'demo://TICKET-101',
        }),
    },
    {
      label: 'Web embed',
      onClick: () =>
        create('llm-wiki:web-embed', {
          w: 480,
          h: 360,
          url: 'https://example.com/',
          title: 'example.com',
        }),
    },
    {
      label: 'Key/value',
      onClick: () =>
        create('llm-wiki:key-value-card', {
          w: 320,
          h: 200,
          title: 'k8s deployment',
          pairs: [
            { key: 'name', value: 'auth-svc' },
            { key: 'replicas', value: '3' },
            { key: 'image', value: 'auth-svc:v1.2.3' },
            { key: 'ready', value: '3/3' },
          ],
          uri: 'k8s://default/auth-svc',
        }),
    },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 200,
        display: 'flex',
        gap: 6,
        padding: 6,
        background: 'rgba(24, 24, 27, 0.95)',
        border: '1px solid #3f3f46',
        borderRadius: 8,
        backdropFilter: 'blur(8px)',
      }}
    >
      <span style={{ fontSize: 11, color: '#71717a', alignSelf: 'center', padding: '0 6px' }}>
        debug
      </span>
      {buttons.map((b) => (
        <button
          key={b.label}
          onClick={b.onClick}
          style={{
            padding: '4px 10px',
            fontSize: 12,
            background: '#27272a',
            color: '#fafafa',
            border: '1px solid #3f3f46',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Mount it inside the canvas**

The `useEditor()` hook must be called from a child of `<Tldraw>`. Update `app/src/canvas/Canvas.tsx` to render the DebugToolbar inside Tldraw's children render slot.

Read the current `Canvas.tsx`. Replace the `<Tldraw ... />` element with the children-render form:

```typescript
import { DebugToolbar } from '../components/DebugToolbar';

// ... in the component return:
<Tldraw
  shapeUtils={customShapeUtils}
  snapshot={initialSnapshot}
  onMount={handleMount}
>
  <DebugToolbar />
</Tldraw>
```

If the installed tldraw 3.x version doesn't accept children on `<Tldraw>`, fall back to mounting DebugToolbar OUTSIDE Tldraw and passing the editor via a ref the Canvas exposes. The cleaner Tldraw-children pattern is the default in 3.x — children are rendered inside the editor's React tree, so `useEditor()` works.

- [ ] **Step 3: Verify build + manual smoke**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm app:build
```

Expected: exit 0. Then:

```bash
pnpm app &
APP_PID=$!
sleep 3
curl -sI http://127.0.0.1:3458 | head -3
kill $APP_PID
```

Expected: 200. Visual verification (manual, on your machine): open http://localhost:3458, click each debug button, see one widget materialize per click.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/components/DebugToolbar.tsx app/src/canvas/Canvas.tsx
git commit -m "feat(app): debug toolbar with one button per widget"
```

---

## Task 9: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Widget Catalog section**

Append to the canvas section from Plan 4b:

```markdown
### Widget catalog (Plan 4c)

Five built-in widgets ship in v1, mirroring spec §3:

| Shape type | ResultKind(s) accepted | Renders |
| --- | --- | --- |
| `llm-wiki:markdown` | `text-document`, `wiki-page` | GFM markdown via react-markdown |
| `llm-wiki:code-block` | `code-symbol`, `code-file` | Monospace block with file/symbol metadata (no syntax highlighting in v1) |
| `llm-wiki:ticket` | `ticket` | Jira-style card: id + title + status pill + assignee + description |
| `llm-wiki:web-embed` | `web-page` | Sandboxed iframe (`sandbox="allow-scripts"`, no same-origin) |
| `llm-wiki:key-value-card` | (fallback for unmapped kinds) | Title + key/value pairs |

The registry at `src/core/widget-registry.ts` maps every `ResultKind` from spec §3 to a widget. Unmapped kinds fall back to `KeyValueCardWidget`.

#### Debug toolbar

A small debug toolbar in the top-left of the canvas creates one example of each widget per click. Useful for visual smoke testing without driving the full result-dispatcher (Plan 4d).

#### Adding a new widget

1. Create `app/src/canvas/shapes/<name>.tsx` exporting a `ShapeUtil` (use any of the existing widgets as a template — they share `app/src/canvas/shapes/shared.tsx` for the card frame style)
2. Register the `ShapeUtil` in `customShapeUtils` in `app/src/canvas/Canvas.tsx`
3. Add a `Widget` entry in `src/core/widget-registry.ts` mapping the `ResultKind` to the new `shapeType`
4. (Plan 4d) The dispatcher will pick up the new mapping automatically

### What's next (Plan 4d–4e)

- **4d**: Result dispatcher — agent's `ResultEnvelope` outputs are routed to widgets on the canvas
- **4e**: Canvas templates (AskAnything, TellMeAboutX, WhatsNewSinceY, TraceXEverywhere)
```

(Use real triple-backticks in the actual README.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: widget catalog + debug toolbar + how to add a widget"
```

---

## Spec coverage check

| Spec section | Implemented in (Plan 4c) | Deferred to |
| --- | --- | --- |
| §3 — `MarkdownWidget` | Task 1 | — |
| §3 — `CodeBlockWidget` | Task 2 (no syntax highlighting in v1) | Plan 4c.1 (syntax) |
| §3 — `TicketCardWidget` | Task 3 | — |
| §3 — `WebEmbedWidget` | Task 4 | Plan 4c.2 (origin allowlist) |
| §3 — `KeyValueCardWidget` (fallback) | Task 5 | — |
| §3 — Result kind → widget dispatch table | Task 6 (`widget-registry.ts`) | — |
| §3 — `WikiPageWidget`, `LogTimelineWidget`, `K8sResourceWidget`, `TableWidget`, `MetricChartWidget`, `ChatMessageWidget`, `RunbookWidget`, `DashboardEmbedWidget` | — (covered by KeyValueCard fallback) | Plan 4c.1+ |

All Plan 4c deliverables traced.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0 (root + app tests)
- [ ] Typecheck (root): `pnpm typecheck` exits 0
- [ ] Typecheck (app): `cd app && pnpm exec tsc --noEmit` exits 0
- [ ] Build: `pnpm app:build` exits 0
- [ ] Manual smoke (optional, on your machine): open http://localhost:3458, click each debug button, see five widget types render with realistic-looking data
- [ ] `git log --oneline` shows ~10 new commits

---

*End of Plan 4c.*
