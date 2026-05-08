# Modernise UI — Spatial / Ambient Design

**Status:** Spec — pending review
**Date:** 2026-05-09
**Scope:** App-wide UI modernisation — design system foundation + Tier 1/2 surfaces
**Estimated effort:** ~1 week, 2 PRs

---

## Summary

Modernise OpenCanvas's UI by introducing a depth/motion design system and applying it to the seven highest-leverage chrome surfaces. The aesthetic direction is **Spatial / Ambient** — pointer-tracked parallax (3°), spring-physics drag, layered glass with role-aware depth auras. The work lands in two PRs: a foundation PR (invisible, lays the token + primitive layer) followed by a surfaces PR (the visible modernisation).

---

## Decisions

These five decisions, captured during brainstorming, anchor the rest of the spec.

| | Choice |
|---|---|
| **Direction** | Spatial / depth (visionOS-ish) — over flat-precise, refined-glass-only, or editorial |
| **Intensity** | **Ambient** — 3° pointer parallax, spring drag, role auras (~40% GPU cost) — over Quiet (no parallax) or Maximalist (7° + iridescent) |
| **Scope** | **Foundation + Tier 1 + Tier 2** — design tokens, motion primitives, then 7 surfaces — over Tight (3 surfaces) or Complete (3-spec project) |
| **Themes** | **Drop `light`, keep dark-family** (`dark`, `midnight`, `sunset`, `mono`) — over keep-all-5 or drop-all-secondary |
| **Identity** | **Light refresh** — Inter → Geist, tighten spacing scale, keep gradient + 6 roles — over keep-identity or full-refresh |

---

## Architecture & file plan

The system has three layers:

- **Layer 1 — tokens** (`app/src/styles/depth.css`, `typography.css`): pure design data. Zero runtime cost.
- **Layer 2 — motion + component primitives** (`app/src/lib/motion/`, `app/src/components/primitives/`): runtime that consumes tokens.
- **Layer 3 — surfaces**: existing chrome refactored to consume tokens and primitives.

### New files (PR 1)

| Path | Purpose |
|---|---|
| `app/src/styles/depth.css` | `--depth-1..4`, `--blur-thin/medium/heavy`, `--glass-recipe-*`, easing/duration tokens. |
| `app/src/styles/typography.css` | Geist `@font-face`, type scale (`--text-2xs..xl`), tracking tokens. |
| `app/src/lib/motion/use-parallax.ts` | Pointer-tracked tilt hook (~40 lines). Returns motion values, not style object. |
| `app/src/lib/motion/springs.ts` | Named spring presets — `spring.soft / firm / snappy`. |
| `app/src/components/primitives/DepthPanel.tsx` | Slide-in panel primitive — replaces 4 panels' duplicated motion + glass scaffold. |
| `app/src/components/primitives/index.ts` | Barrel export. |

### Refactored files

**Tokens consumers (PR 1):**

- `app/src/styles/globals.css` — `@import` `depth.css` and `typography.css`. **Remove** `:root[data-theme='light']` block (lines ~72–130) and matching `.tl-theme__*` overrides.
- `app/src/state/theme-store.ts` — drop `light` from theme union; migrate stored `light` → `dark` once on load.
- `app/index.html` — swap Google Fonts `Inter` → `Geist`. Inter stays as fallback.

**Surface migrations (PR 2):**

- `app/src/canvas/shapes/shared.tsx` — wrap card root with `motion.div` + `useParallax`.
- `app/src/components/FloatingChat.tsx` — titlebar parallax (no body), spring drag config.
- `app/src/components/CommandPalette.tsx` — container parallax (2°), spring config.
- `app/src/components/ConversationsSidebar.tsx` → `<DepthPanel placement="left">`.
- `app/src/components/SourcesPanel.tsx` → `<DepthPanel placement="right">`.
- `app/src/components/McpSourcesPanel.tsx` → `<DepthPanel placement="right">`.
- `app/src/App.tsx` — header chrome polish (mostly via CSS class changes).

### Untouched

- All 17 widget shape util files in `app/src/canvas/shapes/` (markdown, table, time, …) — they consume `.opencanvas-card` via `shared.tsx`, so they get the visual upgrade automatically.
- Tldraw integration (`Canvas.tsx`, `dispatcher.ts`, `stream-mutator.ts`).
- Backend, agent, REST API, MCP server code.
- Tier 3 surfaces: toasts, badges, empty states (deferred).

---

## Design tokens

### Depth scale

```css
/* depth.css */
:root {
  --depth-1-shadow:
    0 1px 2px -1px rgb(0 0 0 / 0.3);
  --depth-2-shadow:
    0 4px 16px -6px rgb(0 0 0 / 0.4),
    0 0 0 1px rgb(255 255 255 / 0.04) inset;
  --depth-3-shadow:
    0 12px 32px -10px rgb(0 0 0 / 0.5),
    0 0 0 1px rgb(255 255 255 / 0.05) inset;
  --depth-4-shadow:
    0 22px 48px -14px rgb(0 0 0 / 0.55),
    0 0 32px -4px var(--role-color-soft, var(--role-primary-soft)),
    0 0 0 1px rgb(255 255 255 / 0.08) inset;
}
```

| Level | Used for |
|---|---|
| `--depth-1` | Status pills, header buttons, badges |
| `--depth-2` | Card resting state, palette rows, toasts |
| `--depth-3` | Panels (chat, drawers, palette container), header chrome |
| `--depth-4` | Cards on hover, drag-active surfaces — adds role-aura bloom |

### Blur scale

```css
--blur-thin:   blur(14px) saturate(140%);
--blur-medium: blur(20px) saturate(160%);
--blur-heavy:  blur(28px) saturate(180%);
```

### Glass recipes — utility classes

Three reusable utilities (CSS custom properties can't hold declaration blocks; these are classes). Each composes `--color-glass-rgb` (already theme-aware) with the blur scale. Replaces per-component glass duplication scattered through `globals.css` lines 730–810. Defined via Tailwind v4's `@utility` directive in `depth.css`:

```css
@utility glass-thin {
  background: rgb(var(--color-glass-rgb) / 0.62);
  border: 1px solid var(--color-line);
  backdrop-filter: var(--blur-thin);
  -webkit-backdrop-filter: var(--blur-thin);
}
@utility glass-medium { /* same shape, 0.72 alpha + --blur-medium */ }
@utility glass-heavy  { /* same shape, 0.82 alpha + --blur-heavy */ }
```

Surfaces apply via `className="glass-medium"` etc., or via `@apply` inside an existing class definition.

### Motion springs

```ts
// app/src/lib/motion/springs.ts
export const spring = {
  soft:   { stiffness: 180, damping: 28, mass: 0.6 },  // drawer enter, card lift
  firm:   { stiffness: 260, damping: 30, mass: 0.5 },  // palette open, parallax
  snappy: { stiffness: 380, damping: 30, mass: 0.4 },  // button press, focus
} as const;
```

```css
/* For surfaces using CSS transitions, not framer-motion */
--ease-soft:   cubic-bezier(.22, 1, .36, 1);
--ease-firm:   cubic-bezier(.4,  0, .2, 1);
--dur-soft:    280ms;
--dur-firm:    200ms;
--dur-snappy:  140ms;
```

### Typography (Geist)

```css
--font-sans:  'Geist', 'Inter', system-ui, sans-serif;
--font-mono:  'JetBrains Mono', ui-monospace, monospace;

--text-2xs:   10.5px;  /* badges, micro pills */
--text-xs:    11.5px;  /* header buttons, status text */
--text-sm:    13px;    /* chat status bar, secondary buttons */
--text-base:  14.5px;  /* body default */
--text-md:    15.5px;  /* wordmark, panel titles */
--text-lg:    18px;    /* section headings */
--text-xl:    24px;    /* empty-state hero */

--tracking-tighter: -0.022em;
--tracking-tight:   -0.012em;
--tracking-normal:   0;
--tracking-wide:     0.04em;
```

### Spacing — discipline, not new tokens

Tailwind v4's existing 4pt scale is the single source. **Rule:** zero bespoke px values in new code. Margins/padding/gap are utility classes (`p-3`, `gap-2`, `space-y-4`).

---

## Motion + component primitives

### `useParallax`

```ts
interface UseParallaxOptions {
  maxTilt?: number;        // degrees, default 3
  lift?: boolean;          // translateZ on hover, default true
  spring?: 'soft' | 'firm' | 'snappy';  // default 'firm'
}

export function useParallax(opts: UseParallaxOptions = {}) {
  // ~40 lines, returns:
  return {
    ref,                                      // attach to surface element
    rotateX, rotateY, translateZ,             // MotionValue<number>
    bind: { onPointerMove, onPointerLeave },  // spread on element
  };
}
```

**Usage:**
```tsx
const { ref, rotateX, rotateY, translateZ, bind } = useParallax({ maxTilt: 3 });
return (
  <motion.div
    ref={ref}
    {...bind}
    style={{ rotateX, rotateY, z: translateZ, transformPerspective: 1200 }}
    className="opencanvas-card"
  >
    {children}
  </motion.div>
);
```

**Behavior:**
- Pointer-relative — distance from surface center, normalized to ±0.5, mapped to ±maxTilt degrees.
- Spring-smoothed via `useSpring` so motion is organic.
- Respects `prefers-reduced-motion` — returns inert motion values.
- Zero React re-renders during pointer move (motion values bypass React state).

**Surfaces opting in:**
| Surface | Tilt | Notes |
|---|---|---|
| Widget cards (`shared.tsx`) | 3° | Primary visual win. |
| Chat titlebar | 2° | Body stays flat for readability. |
| Command palette container | 2° | Subtle. |

**Skipped:** drawers (already animating via slide), header chrome (too thin), Tier 3 (out of scope).

### `<DepthPanel>`

```tsx
interface DepthPanelProps {
  open: boolean;
  onClose: () => void;
  placement?: 'left' | 'right';        // default 'right'
  width?: string;                      // default '380px'
  ariaLabel: string;                   // required
  children: React.ReactNode;
  closeOnBackdrop?: boolean;           // default true
  closeOnEscape?: boolean;             // default true
}
```

Renders `<AnimatePresence>` containing a backdrop `motion.div` + a panel `motion.aside`. Spring config from `springs.ts`. ESC keydown handler attached on mount. Focus trap via `inert` on siblings while open. Restores focus to trigger on close.

**Code reduction** (3 slide-in drawers — palette stays a centered modal and does NOT use DepthPanel):

| Component | Before | After |
|---|---|---|
| ConversationsSidebar.tsx | ~190 | ~50 |
| SourcesPanel.tsx | ~210 | ~60 |
| McpSourcesPanel.tsx | ~315 | ~100 |
| **Total** | **~715** | **~210** |

Net: **~505 lines removed**, mostly duplicated `motion.aside` + `AnimatePresence` + ESC + click-outside boilerplate.

---

## Surface migration plan

Per-surface diff. Files, what stays, what changes.

### Tier 1

#### 1. Widget cards
- **Files:** `globals.css` (`.opencanvas-card` recipe, lines 300–610), `app/src/canvas/shapes/shared.tsx`.
- **Stays:** 6-role color system, card layout slots (header/body/footer/actions/tags), per-role accent lines, all 17 widget kind shape util files.
- **Changes:** `.opencanvas-card` consumes `--depth-2-shadow` + `--glass-medium` resting, `--depth-4-shadow` on `:hover` (role-aura blooms via `var(--role-color-soft)`). `shared.tsx` wraps card root with `motion.div` + `useParallax({ maxTilt: 3 })`. Existing `translateY(-2px)` hover lift gives way to motion-driven `translateZ`.
- **Net:** Cards feel physical. Hover tilt is the headline visual. **No per-shape-file changes.**

#### 2. Header chrome
- **Files:** `globals.css` (`.opencanvas-glass`, `.opencanvas-header-btn`, `.opencanvas-header-divider`), `app/src/App.tsx` (verify utility classes).
- **Stays:** `h-12` height, layout, all child components (KbBadge, HealthBadge, HeaderCanvasControls, HeaderDrawTools, HistoryScrubber, ThemeToggle).
- **Changes:** `.opencanvas-glass` upgrade to `--glass-thin` + `--depth-1-shadow`. `.opencanvas-header-btn` resting `--depth-1`, hover `--depth-2`, retimed via `--ease-firm` + `--dur-firm`. Wordmark gradient unchanged. **No parallax.**
- **Net:** Header reads as a coherent translucent strip; buttons have weight.

#### 3. Floating chat panel
- **Files:** `app/src/components/FloatingChat.tsx`, `globals.css` (`.opencanvas-chat-floating`, `.opencanvas-chat-titlebar`).
- **Stays:** All drag/minimize/fullmode logic, viewport-clamping `useEffect`, child components (Chat, ChatStatusBar, ChatOptionsMenu, ChatBrandMark), launcher bubble.
- **Changes:** `.opencanvas-chat-floating` consumes `--glass-heavy` + `--depth-3-shadow`. **Titlebar only** opts into `useParallax({ maxTilt: 2, lift: false })`. `data-streaming='true'` glow uses `--role-color-soft`. **Drag config (`dragMomentum={false}`) unchanged** — `spring.soft` is reserved for any future shell-mount/snap-back motion, not added to drag in this scope.
- **Net:** Panel feels physical; gentle titlebar tilt suggests "this is a handle." Body stays readable.

#### 4. Command palette
- **Files:** `app/src/components/CommandPalette.tsx`, `globals.css` (`.opencanvas-cmdk-*`, lines 996–1116).
- **Stays:** `cmdk` library, search logic, KB-hits, slash-commands, keyboard nav.
- **Changes:** `.opencanvas-cmdk-panel` consumes `--glass-heavy` + `--depth-3-shadow`. Container opts into `useParallax({ maxTilt: 2 })`. Open animation uses `spring.firm`. `.opencanvas-cmdk-row:hover` uses `--depth-2-shadow` + `scale(1.005)`.
- **Net:** Palette hovers above the canvas; rows pick up subtle weight on hover.

### Tier 2 — drawers (Approach 3 pays for itself here)

#### 5. ConversationsSidebar
- **File:** `app/src/components/ConversationsSidebar.tsx` only.
- **Stays:** Conversation list rendering, search/filter, persistence, item interactions.
- **Changes:** Replace motion scaffold with `<DepthPanel placement="left" width="320px" ariaLabel="Conversations">`. Lift content into `<ConversationList />`.
- **Net:** ~190 lines → ~50.

#### 6. SourcesPanel
- **File:** `app/src/components/SourcesPanel.tsx` only.
- **Changes:** Replace scaffold with `<DepthPanel placement="right" width="380px" ariaLabel="Knowledge sources">`.
- **Net:** ~210 lines → ~60.

#### 7. McpSourcesPanel
- **File:** `app/src/components/McpSourcesPanel.tsx` only.
- **Changes:** Replace scaffold with `<DepthPanel placement="right" width="420px" ariaLabel="MCP servers">`. Internal MCP-server-editing state unchanged.
- **Net:** ~315 lines → ~100.

### Summary

| # | Surface | Files | CSS recipe | Primitive | Parallax |
|---|---|---|:-:|:-:|:-:|
| 1 | Widget cards | globals.css + shared.tsx | yes | — | yes (3°) |
| 2 | Header chrome | globals.css + App.tsx | yes | — | — |
| 3 | Chat panel | FloatingChat.tsx + globals.css | yes | — | titlebar only (2°) |
| 4 | Command palette | CommandPalette.tsx + globals.css | yes | — | yes (2°) |
| 5 | ConversationsSidebar | ConversationsSidebar.tsx | — | DepthPanel | — |
| 6 | SourcesPanel | SourcesPanel.tsx | — | DepthPanel | — |
| 7 | McpSourcesPanel | McpSourcesPanel.tsx | — | DepthPanel | — |

---

## Theme handling

- **Remove:** `:root[data-theme='light']` block (`globals.css` ~72–130) and matching `.tl-theme__*` light overrides.
- **Drop:** `'light'` from `app/src/state/theme-store.ts` theme union.
- **Migrate:** theme-store reads from localStorage on init. If stored value is `'light'`, coerce to `'dark'` and persist back. One-time silent migration.
- **Validate:** depth tokens are theme-agnostic (white/black overlays composed via `--color-glass-rgb` and `--color-line`). The four remaining themes (`dark`, `midnight`, `sunset`, `mono`) each have triplets defined.
- **Visual review per theme** in PR 2 — sunset's warm gradient + a violet aura may need calibration of `--role-color-soft`.

---

## Sequencing — 2 PRs

### PR 1 · Foundation (~2 days)

**Visible to user:** typography swap (Inter → Geist) only. Everything else is invisible until PR 2.

1. Create `app/src/styles/depth.css` (depth, blur, glass, motion tokens).
2. Create `app/src/styles/typography.css` (Geist `@font-face`, type scale, tracking).
3. `@import` both at the top of `globals.css`.
4. Swap font load in `app/index.html`.
5. Create `app/src/lib/motion/springs.ts` + `use-parallax.ts`.
6. Create `app/src/components/primitives/DepthPanel.tsx` + `index.ts`.
7. Remove light-theme blocks from `globals.css`.
8. Update `theme-store.ts` (drop `light`, add migration).
9. Add unit tests for `useParallax` and `<DepthPanel>`.
10. Ship.

### PR 2 · Surfaces (~3–4 days)

The visible modernisation.

1. Migrate `.opencanvas-card` recipe in `globals.css` → consume depth tokens.
2. Wire `useParallax` in `app/src/canvas/shapes/shared.tsx`.
3. Migrate header chrome recipes (`.opencanvas-glass`, `.opencanvas-header-btn`).
4. Migrate `FloatingChat.tsx` + `.opencanvas-chat-floating` recipe.
5. Migrate `CommandPalette.tsx` + `.opencanvas-cmdk-*` recipes.
6. Migrate `ConversationsSidebar.tsx` → `<DepthPanel>`.
7. Migrate `SourcesPanel.tsx` → `<DepthPanel>`.
8. Migrate `McpSourcesPanel.tsx` → `<DepthPanel>`.
9. Manual visual review per theme (dark / midnight / sunset / mono).
10. Ship.

---

## Out of scope

- **Tier 3 surfaces** — Sonner toasts, HealthBadge, KbBadge, EmptyChatBanner, EmptyCanvasHint, status pills. Defer to a follow-up.
- **Light theme** — removed.
- **Color identity** — gradient (`violet→fuchsia→pink`) and the 6-role color system stay as-is.
- **Widget body content** — markdown rendering, tables, charts, code blocks. Out of scope.
- **Tldraw editor chrome** — `Canvas.tsx`, dispatcher, stream-mutator, shape util internals. Out of scope.
- **Backend / agent / REST API / MCP server code.** Out of scope.
- **Light-theme equivalent of depth** (paper-stack metaphor) — explicitly deferred unless light is reintroduced.

---

## Testing

- **Unit (vitest + jsdom):**
  - `useParallax` math at sample pointer positions.
  - `prefers-reduced-motion` returns inert motion values.
  - Ref cleanup on unmount.
  - `<DepthPanel>` mounts/unmounts on `open` change.
  - ESC closes when `closeOnEscape` is true.
  - Backdrop click closes when `closeOnBackdrop` is true.
  - Focus restoration to trigger on close.
- **Integration:** smoke-test that each refactored surface opens/closes (existing testing-library setup).
- **Manual perf:** drag chat panel + hover 5 widgets + open palette simultaneously; confirm 60fps on M1.
- **Visual regression:** not adding automated tooling. Manual screenshot review per PR.
- **Accessibility:** `useParallax` respects `prefers-reduced-motion`; `<DepthPanel>` uses `inert` + `role="dialog"` + `aria-label`. WCAG AA contrast preserved.

---

## Risks + rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tldraw layout interference from `motion.div` wrapping cards | Medium | Use CSS-transform-only (`rotateX/Y/Z` via `style`). Tldraw measures via ResizeObserver which sees outer rect, unchanged. Validate during PR 2. |
| GPU cost on Intel integrated graphics | Low–Medium | `prefers-reduced-motion` already disables. Ship `localStorage.opencanvas-depth-intensity = 'quiet'` escape hatch if reports come in. |
| Geist font load failure | Low | Inter stays in `font-family` fallback chain. |
| Lingering `light` theme references | Low | Grep for `data-theme='light'` and `'light'` in theme-store before merging PR 1. |
| `inert` browser support | Very low | Required Chromium ≥102 / Firefox ≥112; Electron 39 ships Chromium 138. Not a concern. |

**Rollback:** Both PRs are revert-safe.

- **PR 1** — additive (new files, new tokens) + theme removal. Reverting fully restores prior state. The localStorage migration (`light` → `dark`) is one-way per-user but harmless on revert.
- **PR 2** — reverts cleanly because tokens still exist after PR 1; surfaces just stop consuming them.

---

## References

- Source repo: `/Users/krunal/Development/opencanvas`
- Brainstorming companion: `.superpowers/brainstorm/` (not committed)
- Recent UI commits providing context:
  - `cd78b1e redesign(chat): calm glass surface — drop the conic strobe`
  - `66c667b revert(theme): remove theme picker, force dark default`
  - `b8b242b fix(theme): all panels swap with theme — was 15 hardcoded dark literals`
  - `f219ff4 feat(ui): widget revamp — glassmorphism, role auras, role-tinted headers`
  - `67c33d7 fix(ui): tighter color scheme — drop the cyan, neutral surfaces`
