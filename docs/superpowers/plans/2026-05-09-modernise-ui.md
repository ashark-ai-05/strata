# Modernise UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a Spatial/Ambient depth + motion design system to OpenCanvas's chrome — modernise widget cards, header, chat panel, command palette, and three drawers — without touching tldraw integration, agent code, or widget content rendering.

**Architecture:** Three layers. **(1)** CSS design tokens (`depth.css`, `typography.css`) — pure design data, zero runtime cost. **(2)** Motion + component primitives (`use-parallax.ts`, `springs.ts`, `<DepthPanel>`) — runtime that consumes tokens. **(3)** Surface migrations — existing chrome refactored to consume tokens and primitives. Two phases / PRs: foundation first (invisible to users), surfaces second (the visible modernisation).

**Tech Stack:** React 19, framer-motion 12 (already installed), Tailwind v4 with `@theme` + `@utility`, Geist (via Google Fonts), vitest + @testing-library/react + jsdom for tests. Existing patterns followed from `__tests__/app/`.

**Spec:** [`docs/superpowers/specs/2026-05-09-modernise-ui-design.md`](../specs/2026-05-09-modernise-ui-design.md)

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `app/src/lib/motion/springs.ts` | Named spring presets — `soft / firm / snappy`. Single source of truth for motion physics across all surfaces. |
| `app/src/lib/motion/use-parallax.ts` | Pointer-tracked tilt React hook. Consumed opt-in by widget cards, chat titlebar, and command palette. |
| `app/src/styles/depth.css` | Depth/blur/glass CSS tokens + glass utility classes. Imported from `globals.css`. |
| `app/src/styles/typography.css` | Geist `@font-face`, type scale, tracking tokens. Imported from `globals.css`. |
| `app/src/components/primitives/DepthPanel.tsx` | Slide-in panel primitive. Replaces ~715 lines of duplicated motion + glass scaffold across 3 drawers. |
| `app/src/components/primitives/index.ts` | Barrel export. |
| `__tests__/app/springs.test.ts` | Unit tests for spring presets shape. |
| `__tests__/app/use-parallax.test.tsx` | Unit tests for the hook (return shape, reduced-motion, pointer math). |
| `__tests__/app/DepthPanel.test.tsx` | Unit tests for the panel primitive (mount/unmount, ESC, backdrop, focus). |
| `__tests__/app/theme-store-light-removal.test.ts` | Migration test for `light` → `dark`. |

### Modified files

| Path | What changes |
|---|---|
| `app/src/styles/globals.css` | `@import` `depth.css` + `typography.css`. Remove light-theme blocks (~lines 72–130). Migrate `.opencanvas-card`, `.opencanvas-glass`, `.opencanvas-header-btn`, `.opencanvas-cmdk-*`, `.opencanvas-chat-floating`, `.opencanvas-chat-titlebar` to consume new tokens. |
| `app/index.html` | Swap Google Fonts URL — `Inter` → `Geist`. |
| `app/src/state/theme-store.ts` | Drop `'light'` from `THEMES` tuple + `THEME_META`. Simplify `tldrawColorSchemeFor` (always returns `'dark'`). |
| `app/src/canvas/shapes/shared.tsx` | Wrap card root with `motion.div` + `useParallax`. |
| `app/src/components/FloatingChat.tsx` | Add `useParallax` on titlebar (only). Spring presets imported but drag config unchanged. |
| `app/src/components/CommandPalette.tsx` | Add `useParallax` on container. Use `spring.firm` for open animation. |
| `app/src/components/ConversationsSidebar.tsx` | Replace motion scaffold with `<DepthPanel placement="left">`. |
| `app/src/components/SourcesPanel.tsx` | Replace motion scaffold with `<DepthPanel placement="right">`. |
| `app/src/components/McpSourcesPanel.tsx` | Replace motion scaffold with `<DepthPanel placement="right">`. |
| `app/src/App.tsx` | No structural changes — picks up CSS upgrades automatically via class names. |

### Test commands (used throughout)

- **Frontend tests only** (jsdom): `pnpm exec vitest run --config app/vite.config.ts`
- **Single test file**: `pnpm exec vitest run --config app/vite.config.ts <path>`
- **Typecheck (root)**: `pnpm typecheck`
- **Typecheck (app)**: `pnpm exec tsc --noEmit -p app/tsconfig.json`
- **Backend tests**: `pnpm test` (root, untouched by this plan)

---

# Phase 1 — Foundation (invisible PR)

Lands tokens, primitives, hook, and the `light` removal. After Phase 1 ships, **users see only the typography swap** (Inter → Geist). Surfaces don't yet consume the new tokens — that's Phase 2.

---

### Task 1: Spring presets

**Files:**
- Create: `app/src/lib/motion/springs.ts`
- Create: `__tests__/app/springs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/app/springs.test.ts
import { describe, it, expect } from 'vitest';
import { spring } from '../../app/src/lib/motion/springs';

describe('motion/springs', () => {
  it('exposes soft, firm, and snappy presets with calibrated physics', () => {
    expect(spring.soft).toEqual({ stiffness: 180, damping: 28, mass: 0.6 });
    expect(spring.firm).toEqual({ stiffness: 260, damping: 30, mass: 0.5 });
    expect(spring.snappy).toEqual({ stiffness: 380, damping: 30, mass: 0.4 });
  });

  it('preset keys are exhaustive', () => {
    expect(Object.keys(spring).sort()).toEqual(['firm', 'snappy', 'soft']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/springs.test.ts
```
Expected: FAIL — `Cannot find module '../../app/src/lib/motion/springs'`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/motion/springs.ts

/**
 * Named spring presets — the single source of truth for motion physics.
 *
 * All surfaces (panels, palette, parallax) draw from these so the app
 * feels like one physical world. If you tune one preset, the whole
 * system updates.
 *
 * Calibration:
 *   soft   — drawer enter, card lift. Slow, organic, slight overshoot.
 *   firm   — palette open, parallax tilt. Default for most motion.
 *   snappy — button press, focus ring. Near-instant, no overshoot.
 */
export const spring = {
  soft:   { stiffness: 180, damping: 28, mass: 0.6 },
  firm:   { stiffness: 260, damping: 30, mass: 0.5 },
  snappy: { stiffness: 380, damping: 30, mass: 0.4 },
} as const;

export type SpringPreset = keyof typeof spring;
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/springs.test.ts
```
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/motion/springs.ts __tests__/app/springs.test.ts
git commit -m "feat(motion): add named spring presets — soft / firm / snappy"
```

---

### Task 2: `useParallax` hook

**Files:**
- Create: `app/src/lib/motion/use-parallax.ts`
- Create: `__tests__/app/use-parallax.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/app/use-parallax.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useParallax } from '../../app/src/lib/motion/use-parallax';

// jsdom doesn't ship matchMedia. Default to "reduced-motion: false" so the
// hook returns its active branch unless a test overrides matches=true.
function mockMatchMedia(reducedMotion: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reducedMotion && query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  mockMatchMedia(false);
});

describe('useParallax', () => {
  it('returns ref, motion values, and bind handlers', () => {
    const { result } = renderHook(() => useParallax());
    expect(result.current.ref).toBeDefined();
    expect(result.current.rotateX).toBeDefined();
    expect(result.current.rotateY).toBeDefined();
    expect(result.current.translateZ).toBeDefined();
    expect(typeof result.current.bind.onPointerMove).toBe('function');
    expect(typeof result.current.bind.onPointerLeave).toBe('function');
  });

  it('initial motion values are 0 at rest', () => {
    const { result } = renderHook(() => useParallax({ maxTilt: 5 }));
    expect(result.current.rotateX.get()).toBe(0);
    expect(result.current.rotateY.get()).toBe(0);
    expect(result.current.translateZ.get()).toBe(0);
  });

  it('returns inert motion values when prefers-reduced-motion is set', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useParallax({ maxTilt: 5 }));

    // Attach a fake element to the ref via createElement (no innerHTML).
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    (result.current.ref as React.MutableRefObject<HTMLElement>).current = el;

    // Even after a pointer move, values stay at 0 under reduced motion.
    act(() => {
      result.current.bind.onPointerMove({
        clientX: 200,
        clientY: 100,
      } as PointerEvent);
    });

    expect(result.current.rotateX.get()).toBe(0);
    expect(result.current.rotateY.get()).toBe(0);
    expect(result.current.translateZ.get()).toBe(0);
  });

  it('onPointerLeave does not throw and is callable', () => {
    const { result } = renderHook(() => useParallax({ maxTilt: 5 }));
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    (result.current.ref as React.MutableRefObject<HTMLElement>).current = el;

    act(() => {
      result.current.bind.onPointerMove({
        clientX: 200,
        clientY: 100,
      } as PointerEvent);
    });
    expect(() => {
      act(() => {
        result.current.bind.onPointerLeave();
      });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/use-parallax.test.tsx
```
Expected: FAIL — `Cannot find module '../../app/src/lib/motion/use-parallax'`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/motion/use-parallax.ts
import { useRef, useCallback } from 'react';
import {
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from 'framer-motion';
import { spring, type SpringPreset } from './springs';

interface UseParallaxOptions {
  /** Maximum tilt in degrees on either axis. Default 3 (Ambient calibration). */
  maxTilt?: number;
  /** Whether the surface lifts toward the pointer in z. Default true. */
  lift?: boolean;
  /** Spring preset name. Default 'firm'. */
  spring?: SpringPreset;
}

interface UseParallaxReturn {
  ref: React.MutableRefObject<HTMLElement | null>;
  rotateX: MotionValue<number>;
  rotateY: MotionValue<number>;
  translateZ: MotionValue<number>;
  bind: {
    onPointerMove: (e: PointerEvent | React.PointerEvent) => void;
    onPointerLeave: () => void;
  };
}

/**
 * Pointer-tracked parallax hook.
 *
 * Returns motion values (NOT a style object) so framer-motion can update
 * the DOM via requestAnimationFrame without re-rendering React. The hook
 * fires hundreds of times per second during pointer move; React renders
 * exactly once on mount.
 *
 * Reduced-motion: when the user has `prefers-reduced-motion: reduce` set,
 * all motion values stay at 0 regardless of pointer activity. Required —
 * tilt without this is a vestibular accessibility violation.
 *
 * Perspective: consumers MUST set `transformPerspective: 1200` (or similar)
 * on the same `style` block — otherwise rotateX/Y read as flat skew, not
 * 3D tilt. See spec §motion-primitives.
 */
export function useParallax(opts: UseParallaxOptions = {}): UseParallaxReturn {
  const {
    maxTilt = 3,
    lift = true,
    spring: springName = 'firm',
  } = opts;

  const ref = useRef<HTMLElement | null>(null);
  const rawX = useMotionValue(0); // -0.5 .. 0.5 normalized
  const rawY = useMotionValue(0);

  const config = spring[springName];
  const smoothX = useSpring(rawX, config);
  const smoothY = useSpring(rawY, config);

  const reducedMotion = useReducedMotion();

  // When reduced motion is active, expose constant 0 motion values.
  // We can't conditionally call hooks, so we always create them and
  // return constants instead.
  const zeroX = useMotionValue(0);
  const zeroY = useMotionValue(0);
  const zeroZ = useMotionValue(0);

  const rotateY = useTransform(smoothX, [-0.5, 0.5], [maxTilt, -maxTilt]);
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [-maxTilt, maxTilt]);
  const translateZ = useTransform(
    [smoothX, smoothY] as MotionValue<number>[],
    (values) => {
      const [xv, yv] = values as [number, number];
      return lift ? Math.hypot(xv, yv) * 8 : 0;
    },
  );

  const onPointerMove = useCallback(
    (e: PointerEvent | React.PointerEvent) => {
      if (reducedMotion) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      rawX.set(px);
      rawY.set(py);
    },
    [reducedMotion, rawX, rawY],
  );

  const onPointerLeave = useCallback(() => {
    rawX.set(0);
    rawY.set(0);
  }, [rawX, rawY]);

  if (reducedMotion) {
    return {
      ref,
      rotateX: zeroX,
      rotateY: zeroY,
      translateZ: zeroZ,
      bind: { onPointerMove, onPointerLeave },
    };
  }

  return {
    ref,
    rotateX,
    rotateY,
    translateZ,
    bind: { onPointerMove, onPointerLeave },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/use-parallax.test.tsx
```
Expected: PASS — 4 tests.

- [ ] **Step 5: Run typecheck**

```
pnpm exec tsc --noEmit -p app/tsconfig.json
```
Expected: clean — no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/motion/use-parallax.ts __tests__/app/use-parallax.test.tsx
git commit -m "feat(motion): add useParallax hook — pointer-tracked tilt"
```

---

### Task 3: Depth tokens stylesheet

**Files:**
- Create: `app/src/styles/depth.css`
- Modify: `app/src/styles/globals.css` (add `@import` at top)

- [ ] **Step 1: Create `depth.css` with depth, blur, motion tokens + glass utilities**

```css
/* app/src/styles/depth.css
 *
 * Spatial / Ambient depth design tokens.
 *
 * - Depth scale: 4 levels of z-axis layering, each bundling shadow + inset
 *   highlight. The inset highlight reads as "lit from above" — without it,
 *   deep shadows look like falling holes.
 * - Blur scale: backdrop-filter intensities. Each step ≈ +30% GPU cost.
 * - Glass utilities: composed via Tailwind v4 @utility — apply with
 *   className="glass-thin|medium|heavy". Each composes --color-glass-rgb
 *   (already theme-aware via globals.css per-theme blocks).
 * - Motion: ease/duration tokens for surfaces using CSS transitions
 *   instead of framer-motion springs.
 *
 * Spec: docs/superpowers/specs/2026-05-09-modernise-ui-design.md
 */

:root {
  /* Depth scale */
  --depth-1-shadow:
    0 1px 2px -1px rgb(0 0 0 / 0.30);
  --depth-2-shadow:
    0 4px 16px -6px rgb(0 0 0 / 0.40),
    0 0 0 1px rgb(255 255 255 / 0.04) inset;
  --depth-3-shadow:
    0 12px 32px -10px rgb(0 0 0 / 0.50),
    0 0 0 1px rgb(255 255 255 / 0.05) inset;
  --depth-4-shadow:
    0 22px 48px -14px rgb(0 0 0 / 0.55),
    0 0 32px -4px var(--role-color-soft, var(--role-primary-soft)),
    0 0 0 1px rgb(255 255 255 / 0.08) inset;

  /* Blur scale */
  --blur-thin:   blur(14px) saturate(140%);
  --blur-medium: blur(20px) saturate(160%);
  --blur-heavy:  blur(28px) saturate(180%);

  /* CSS-only motion (for surfaces not on framer-motion) */
  --ease-soft:   cubic-bezier(0.22, 1.00, 0.36, 1.00);
  --ease-firm:   cubic-bezier(0.40, 0.00, 0.20, 1.00);
  --dur-soft:    280ms;
  --dur-firm:    200ms;
  --dur-snappy:  140ms;
}

/* Glass recipe utilities. Apply via className="glass-thin" etc., or via
 * @apply inside an existing class definition. Each utility composes the
 * theme-aware --color-glass-rgb triplet (defined per :root[data-theme=*]
 * in globals.css) with a blur-scale step. */
@utility glass-thin {
  background: rgb(var(--color-glass-rgb) / 0.62);
  border: 1px solid var(--color-line);
  backdrop-filter: var(--blur-thin);
  -webkit-backdrop-filter: var(--blur-thin);
}

@utility glass-medium {
  background: rgb(var(--color-glass-rgb) / 0.72);
  border: 1px solid var(--color-line);
  backdrop-filter: var(--blur-medium);
  -webkit-backdrop-filter: var(--blur-medium);
}

@utility glass-heavy {
  background: rgb(var(--color-glass-rgb) / 0.82);
  border: 1px solid var(--color-line);
  backdrop-filter: var(--blur-heavy);
  -webkit-backdrop-filter: var(--blur-heavy);
}
```

- [ ] **Step 2: Add `@import` of depth.css at the top of globals.css**

Open `app/src/styles/globals.css`. Find line 1 (`@import "tailwindcss";`). Insert immediately after:

```css
@import "tailwindcss";
@import "./depth.css";
```

- [ ] **Step 3: Run app typecheck (sanity — Tailwind v4 picks up @utility)**

```
pnpm exec tsc --noEmit -p app/tsconfig.json
```
Expected: clean.

- [ ] **Step 4: Run existing app tests to confirm no regression**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all existing tests still pass (no behavior change yet).

- [ ] **Step 5: Visual smoke test — boot the app and confirm CSS variables are live**

Start the dev server: `pnpm dev`. Open http://127.0.0.1:3458 in a browser. In DevTools console, run:

```js
getComputedStyle(document.documentElement).getPropertyValue('--depth-2-shadow')
```

Expected: returns a non-empty shadow string starting with `0 4px 16px -6px`. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/src/styles/depth.css app/src/styles/globals.css
git commit -m "feat(ui): add depth/blur/motion tokens + glass utilities"
```

---

### Task 4: Typography tokens stylesheet

**Files:**
- Create: `app/src/styles/typography.css`
- Modify: `app/src/styles/globals.css` (add `@import`)

- [ ] **Step 1: Create `typography.css`**

```css
/* app/src/styles/typography.css
 *
 * Geist + type/tracking scale.
 *
 * Geist is loaded via Google Fonts in app/index.html. Inter remains as a
 * fallback (kept loaded so legacy .font-sans references and any
 * unmigrated text rendering don't shift visually mid-rollout).
 *
 * Sizes are calibrated for OpenCanvas's chrome (10–13px) and body
 * (14–16px) ranges. Geist's natural metrics are tighter than Inter at
 * sub-pixel sizes, so chrome sizes are bumped down 0.5–1px without
 * legibility loss.
 *
 * Spec: docs/superpowers/specs/2026-05-09-modernise-ui-design.md
 */

:root {
  --font-sans: 'Geist', 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;

  --text-2xs:  10.5px;
  --text-xs:   11.5px;
  --text-sm:   13px;
  --text-base: 14.5px;
  --text-md:   15.5px;
  --text-lg:   18px;
  --text-xl:   24px;

  --tracking-tighter: -0.022em;
  --tracking-tight:   -0.012em;
  --tracking-normal:   0;
  --tracking-wide:     0.04em;
}
```

- [ ] **Step 2: Add `@import` to globals.css**

Open `app/src/styles/globals.css`. After the `@import "./depth.css";` line added in Task 3, insert:

```css
@import "tailwindcss";
@import "./depth.css";
@import "./typography.css";
```

- [ ] **Step 3: Run app tests to confirm no regression**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/styles/typography.css app/src/styles/globals.css
git commit -m "feat(ui): add Geist + type/tracking scale tokens"
```

---

### Task 5: Swap Inter → Geist in `app/index.html`

**Files:**
- Modify: `app/index.html`

- [ ] **Step 1: Update the Google Fonts link**

Open `app/index.html`. Replace the existing `<link href="...family=Inter..." />` element (line 11–14):

**Before:**
```html
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

**After:**
```html
    <link
      href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

(Geist primary, Inter kept as fallback per typography.css `--font-sans` declaration.)

- [ ] **Step 2: Apply `--font-sans` to body in globals.css**

Open `app/src/styles/globals.css`. Locate the `@layer base` block around line 246. Add a `body` rule (or extend the existing one if present):

```css
@layer base {
  body {
    font-family: var(--font-sans);
  }
}
```

If a `body` rule already exists in `@layer base`, just add `font-family: var(--font-sans);` to it.

- [ ] **Step 3: Boot the app to confirm Geist loads**

```
pnpm dev
```

Open http://127.0.0.1:3458. In DevTools, inspect the wordmark element. Computed `font-family` should resolve `Geist`. Network tab should show a successful request to `fonts.gstatic.com` for Geist. Stop dev server.

- [ ] **Step 4: Run app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/index.html app/src/styles/globals.css
git commit -m "feat(ui): swap Inter → Geist as primary font (Inter kept as fallback)"
```

---

### Task 6: Drop `light` from theme-store + remove light-theme CSS

**Files:**
- Modify: `app/src/state/theme-store.ts`
- Modify: `app/src/styles/globals.css` (delete light-theme blocks)
- Create: `__tests__/app/theme-store-light-removal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/app/theme-store-light-removal.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshStore() {
  vi.resetModules();
  return await import('../../app/src/state/theme-store');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme-store — light theme removal', () => {
  it("THEMES tuple does not include 'light'", async () => {
    const mod = await freshStore();
    expect(mod.THEMES).not.toContain('light');
  });

  it('THEME_META does not have a light entry', async () => {
    const mod = await freshStore();
    expect(mod.THEME_META).not.toHaveProperty('light');
  });

  it('THEMES contains exactly the 4 dark-family themes', async () => {
    const mod = await freshStore();
    expect([...mod.THEMES].sort()).toEqual(
      ['dark', 'midnight', 'mono', 'sunset'],
    );
  });

  it("tldrawColorSchemeFor always returns 'dark'", async () => {
    const mod = await freshStore();
    for (const theme of mod.THEMES) {
      expect(mod.tldrawColorSchemeFor(theme)).toBe('dark');
    }
  });

  it('boots with dark theme even if localStorage previously had light', async () => {
    // Simulate a user who'd selected 'light' before this change shipped.
    localStorage.setItem('opencanvas:theme', 'light');
    const mod = await freshStore();
    const initial = mod.useThemeStore.getState().theme;
    expect(initial).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/theme-store-light-removal.test.ts
```
Expected: FAIL — `THEMES contains 'light'`.

- [ ] **Step 3: Update `theme-store.ts`**

Open `app/src/state/theme-store.ts`.

**Edit 1** — Update the `THEMES` tuple (line 32):

**Before:**
```ts
export const THEMES = ['dark', 'light', 'midnight', 'sunset', 'mono'] as const;
```

**After:**
```ts
export const THEMES = ['dark', 'midnight', 'sunset', 'mono'] as const;
```

**Edit 2** — Remove the `light` entry from `THEME_META` (lines 50–54):

Delete this block:
```ts
  light: {
    label: 'Light',
    description: 'Paper white · violet accent',
    swatches: ['#fafafa', '#ffffff', '#a78bfa'],
  },
```

**Edit 3** — Simplify `tldrawColorSchemeFor` (lines 107–109):

**Before:**
```ts
export function tldrawColorSchemeFor(theme: Theme): 'dark' | 'light' {
  return theme === 'light' ? 'light' : 'dark';
}
```

**After:**
```ts
export function tldrawColorSchemeFor(_theme: Theme): 'dark' {
  // All four shipped themes are dark-family. The 'light' theme was
  // removed in the modernise-ui project (spec 2026-05-09); tldraw's
  // canvas always renders against a dark surface.
  return 'dark';
}
```

**Edit 4** — Update the doc comment on the `THEMES` declaration (lines 19–31). Replace the existing comment:

```ts
/**
 * The 4 shipped themes (all dark-family — light was removed in the
 * modernise-ui project, spec 2026-05-09):
 *   - dark      : neutral charcoal + violet/magenta accent (default)
 *   - midnight  : deep indigo/navy + cool electric-blue accent
 *   - sunset    : warm wine/brown + orange/amber accent
 *   - mono      : pure grayscale, no chromatic accent
 *
 * Each theme keeps the same role hues (primary=violet, detail=blue,
 * etc.) so widgets stay glanceable across themes — only chrome /
 * surface / brand gradient shifts. The exception is `mono`, which
 * desaturates roles to fit the monochrome aesthetic.
 */
```

- [ ] **Step 4: Run the test to verify it passes**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/theme-store-light-removal.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 5: Run typecheck — catches any callers of `tldrawColorSchemeFor` that asserted on `'light'`**

```
pnpm exec tsc --noEmit -p app/tsconfig.json
```
Expected: clean. If any caller's logic depended on the `'light'` return type, the typecheck will surface it. Fix by removing the dead branch (likely in `Canvas.tsx`).

- [ ] **Step 6: Remove `:root[data-theme='light']` blocks from globals.css**

Open `app/src/styles/globals.css`. Delete the entire light-theme section (approximately lines 71–130 in the current file — verify exact boundaries):

```bash
grep -n "data-theme='light'" app/src/styles/globals.css
```

Delete every block whose selector starts with `:root[data-theme='light']` along with their bodies. There are roughly 6 such blocks per the spec (`:root` overrides, `.tl-theme__*`, `::selection`, `.opencanvas-card`, `.opencanvas-card::after`, `.opencanvas-card:hover`, `.opencanvas-card-header`, `.opencanvas-glass`).

Verify nothing references `data-theme='light'` afterwards:

```bash
grep -n "data-theme='light'" app/src/styles/globals.css
```

Expected: no output.

- [ ] **Step 7: Run all app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/src/state/theme-store.ts app/src/styles/globals.css __tests__/app/theme-store-light-removal.test.ts
git commit -m "feat(ui): drop light theme — keep dark-family (dark/midnight/sunset/mono)"
```

---

### Task 7: `<DepthPanel>` primitive

**Files:**
- Create: `app/src/components/primitives/DepthPanel.tsx`
- Create: `app/src/components/primitives/index.ts`
- Create: `__tests__/app/DepthPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/app/DepthPanel.test.tsx
//
// @testing-library/react auto-cleans up between tests, so no manual
// document teardown is needed in beforeEach.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepthPanel } from '../../app/src/components/primitives/DepthPanel';

// The inert-on-#root focus-trap requires #root to exist. The renderer
// from @testing-library/react mounts into a fresh container that's NOT
// #root, so we add one explicitly for tests that need it.
beforeEach(() => {
  const rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);
});

afterEach(() => {
  document.getElementById('root')?.remove();
});

describe('<DepthPanel>', () => {
  it('mounts content when open=true', () => {
    render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div data-testid="content">hello</div>
      </DepthPanel>,
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Test panel' })).toBeInTheDocument();
  });

  it('does not mount content when open=false', () => {
    render(
      <DepthPanel open={false} onClose={vi.fn()} ariaLabel="Test panel">
        <div data-testid="content">hello</div>
      </DepthPanel>,
    );
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('calls onClose when ESC is pressed (default)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel open onClose={onClose} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on ESC when closeOnEscape=false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel
        open
        onClose={onClose}
        closeOnEscape={false}
        ariaLabel="Test panel"
      >
        <div>x</div>
      </DepthPanel>,
    );
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked (default)', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel open onClose={onClose} ariaLabel="Test panel">
        <div>content</div>
      </DepthPanel>,
    );
    const backdrop = screen.getByTestId('depth-panel-backdrop');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose on backdrop click when closeOnBackdrop=false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DepthPanel
        open
        onClose={onClose}
        closeOnBackdrop={false}
        ariaLabel="Test panel"
      >
        <div>content</div>
      </DepthPanel>,
    );
    const backdrop = screen.getByTestId('depth-panel-backdrop');
    await user.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('honors placement="left" via data attribute', () => {
    render(
      <DepthPanel open onClose={vi.fn()} placement="left" ariaLabel="Left panel">
        <div>x</div>
      </DepthPanel>,
    );
    const aside = screen.getByRole('dialog', { name: 'Left panel' });
    expect(aside.getAttribute('data-placement')).toBe('left');
  });

  it('defaults placement to "right"', () => {
    render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    const aside = screen.getByRole('dialog', { name: 'Test panel' });
    expect(aside.getAttribute('data-placement')).toBe('right');
  });

  it('marks #root as inert while open and removes it on close', () => {
    const { rerender } = render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    const root = document.getElementById('root')!;
    expect(root.hasAttribute('inert')).toBe(true);

    rerender(
      <DepthPanel open={false} onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    expect(root.hasAttribute('inert')).toBe(false);
  });

  it('restores focus to the previously-active element on close', () => {
    // Set up a button that "opens" the panel (focused before mount).
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <DepthPanel open onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );

    // Close the panel — focus should return to the trigger.
    rerender(
      <DepthPanel open={false} onClose={vi.fn()} ariaLabel="Test panel">
        <div>x</div>
      </DepthPanel>,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/DepthPanel.test.tsx
```
Expected: FAIL — `Cannot find module '../../app/src/components/primitives/DepthPanel'`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/src/components/primitives/DepthPanel.tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '../../lib/motion/springs';

export interface DepthPanelProps {
  open: boolean;
  onClose: () => void;
  /** Side of viewport the panel slides in from. Default 'right'. */
  placement?: 'left' | 'right';
  /** Panel width as a CSS length. Default '380px'. */
  width?: string;
  /** Required for screen-reader announcements. */
  ariaLabel: string;
  children: ReactNode;
  /** Click outside the panel closes it. Default true. */
  closeOnBackdrop?: boolean;
  /** ESC closes the panel. Default true. */
  closeOnEscape?: boolean;
}

/**
 * Slide-in panel primitive — replaces the duplicated motion + glass
 * scaffold across ConversationsSidebar / SourcesPanel / McpSourcesPanel.
 *
 * Behavior:
 * - Backdrop fade in/out, click-to-close (configurable).
 * - ESC handler attached on mount, removed on unmount.
 * - Spring-physics slide animation from the placement edge.
 * - Focus trap via `inert` on #root while open (rendered via createPortal
 *   to document.body so the panel itself isn't inert).
 * - Restores focus to the trigger element on close.
 * - role="dialog" + aria-label for screen-reader semantics.
 *
 * Spec: docs/superpowers/specs/2026-05-09-modernise-ui-design.md
 */
export function DepthPanel({
  open,
  onClose,
  placement = 'right',
  width = '380px',
  ariaLabel,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: DepthPanelProps) {
  const previousActiveRef = useRef<HTMLElement | null>(null);

  // ESC keydown handler — attached only while the panel is open.
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeOnEscape, onClose]);

  // Focus trap (via `inert` on app root) + focus restoration on close.
  // The panel is portaled to document.body so #root can be marked inert
  // without making the panel itself inert.
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById('root');
    if (appRoot) appRoot.setAttribute('inert', '');

    return () => {
      if (appRoot) appRoot.removeAttribute('inert');
      // Restore focus to the trigger that opened us. Use a microtask
      // so React has finished its commit phase before we focus.
      const target = previousActiveRef.current;
      if (target && typeof target.focus === 'function') {
        queueMicrotask(() => target.focus());
      }
    };
  }, [open]);

  const slideFrom = placement === 'left' ? `-${width}` : width;

  // SSR safety — the createPortal target requires a DOM.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            data-testid="depth-panel-backdrop"
            className="opencanvas-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={closeOnBackdrop ? onClose : undefined}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgb(0 0 0 / 0.40)',
              backdropFilter: 'blur(2px)',
              zIndex: 50,
            }}
          />
          <motion.aside
            role="dialog"
            aria-label={ariaLabel}
            data-placement={placement}
            className="opencanvas-panel glass-heavy"
            initial={{ x: slideFrom }}
            animate={{ x: 0 }}
            exit={{ x: slideFrom }}
            transition={spring.firm}
            style={{
              position: 'fixed',
              top: 0,
              bottom: 0,
              [placement]: 0,
              width,
              boxShadow: 'var(--depth-3-shadow)',
              zIndex: 51,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
```

- [ ] **Step 4: Create the barrel export**

```ts
// app/src/components/primitives/index.ts
export { DepthPanel, type DepthPanelProps } from './DepthPanel';
```

- [ ] **Step 5: Run tests to verify they pass**

```
pnpm exec vitest run --config app/vite.config.ts __tests__/app/DepthPanel.test.tsx
```
Expected: PASS — 10 tests.

- [ ] **Step 6: Run typecheck**

```
pnpm exec tsc --noEmit -p app/tsconfig.json
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/primitives/DepthPanel.tsx app/src/components/primitives/index.ts __tests__/app/DepthPanel.test.tsx
git commit -m "feat(ui): add DepthPanel primitive — slide-in glass panel"
```

---

### Task 8: Verify foundation passes a full app-test sweep + open Phase-1 PR

**Files:** none (verification only)

- [ ] **Step 1: Run full app test suite**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass (existing 200+ tests + 4 new test files).

- [ ] **Step 2: Run root typecheck**

```
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Boot the app, smoke-test all surfaces still work as before**

```
pnpm dev
```

Open http://127.0.0.1:3458. Verify:
- App loads without console errors.
- Wordmark renders in Geist (visible via DevTools "Computed" pane).
- Open conversations sidebar (history button) — opens and closes normally.
- Open sources panel (KB badge) — opens and closes normally.
- Open MCP panel (server icon) — opens and closes normally.
- Open command palette (⌘K) — opens, search works, closes on ESC.
- Place a test widget via REST: `curl -X POST http://localhost:3457/v1/canvas/widgets -H 'content-type: application/json' -d '{"kind":"markdown","role":"primary","payload":{"body":"# Phase 1 smoke test"}}'` — widget appears on canvas.

Stop the dev server.

- [ ] **Step 4: Open Phase-1 PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(ui): modernise UI — phase 1 (foundation)" --body "$(cat <<'EOF'
## Summary
- Adds depth/blur/glass/motion design tokens (depth.css)
- Adds Geist + type/tracking scale (typography.css)
- Adds useParallax hook + spring presets (lib/motion)
- Adds <DepthPanel> primitive (components/primitives)
- Drops light theme — keeps dark/midnight/sunset/mono
- Swaps Inter → Geist as primary font (Inter retained as fallback)

**Visual impact: typography only** — surfaces don't yet consume the new tokens. Phase 2 (separate PR) wires them up.

Spec: docs/superpowers/specs/2026-05-09-modernise-ui-design.md

## Test plan
- [ ] vitest passes (`pnpm exec vitest run --config app/vite.config.ts`)
- [ ] typecheck clean (`pnpm typecheck`)
- [ ] app boots, no console errors
- [ ] Geist visibly renders (DevTools → Computed → font-family)
- [ ] All 3 drawers + palette open/close as before
- [ ] Widget rendering unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Phase 1 complete.** Wait for review/merge before starting Phase 2.

---

# Phase 2 — Surfaces (visible PR)

Wires the foundation into the seven Tier 1 + Tier 2 surfaces. **This is where users see the modernisation.**

---

### Task 9: `.opencanvas-card` recipe — consume depth tokens

**Files:**
- Modify: `app/src/styles/globals.css` (`.opencanvas-card` block — currently lines ~300–410)

- [ ] **Step 1: Locate the existing card block**

```bash
grep -n "^\.opencanvas-card " app/src/styles/globals.css
```

Note line numbers — the block starts at the line shown and ends before the first `.opencanvas-card-` (header/title/etc.) selector.

- [ ] **Step 2: Replace the resting card recipe with token-driven values**

Edit `app/src/styles/globals.css`. Find the `.opencanvas-card {` rule and replace its body (the box shadow, border, etc. — keep layout-related properties like padding/border-radius if they exist):

**Before** (representative — verify against actual file):
```css
.opencanvas-card {
  background: linear-gradient(180deg, rgba(28, 28, 34, 0.86) 0%, rgba(20, 20, 26, 0.86) 100%);
  border: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
  /* … other rules … */
}
```

**After:**
```css
.opencanvas-card {
  background:
    linear-gradient(180deg, rgb(var(--color-glass-rgb) / 0.78) 0%, rgb(var(--color-glass-rgb) / 0.86) 100%),
    radial-gradient(
      ellipse at top left,
      var(--role-color-soft, var(--role-primary-soft)) 0%,
      transparent 60%
    );
  border: 1px solid var(--color-line);
  box-shadow: var(--depth-2-shadow);
  backdrop-filter: var(--blur-medium);
  -webkit-backdrop-filter: var(--blur-medium);
  /* keep existing layout rules — padding, border-radius, etc. */
}
```

- [ ] **Step 3: Replace the `:hover` recipe**

Find `.opencanvas-card:hover {` and update its box-shadow + border-color:

```css
.opencanvas-card:hover {
  box-shadow: var(--depth-4-shadow);
  border-color: color-mix(in oklab, var(--role-color, var(--role-primary)) 50%, var(--color-line));
  /* drop any explicit translateY — useParallax now drives the lift */
}
```

If the existing rule had `transform: translateY(-2px);` — DELETE that line. Parallax replaces it.

- [ ] **Step 4: Run all app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 5: Visual smoke test**

```
pnpm dev
```

Open http://127.0.0.1:3458. Place a widget:
```bash
curl -X POST http://localhost:3457/v1/canvas/widgets -H 'content-type: application/json' \
  -d '{"kind":"markdown","role":"primary","payload":{"body":"# Card depth check"}}'
```

Verify visually:
- Card has a noticeable raised feel (depth-2 shadow).
- Hover the card with the cursor — shadow gets dramatically larger and gains a violet aura (depth-4). Border color shifts violet-ish.
- Place additional widgets with different roles (`detail`, `related`, etc.) — verify aura color changes per role.

Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add app/src/styles/globals.css
git commit -m "feat(ui): card recipe consumes --depth-2/4 + role-aura on hover"
```

---

### Task 10: Widget cards — opt into `useParallax` via `shared.tsx`

**Files:**
- Modify: `app/src/canvas/shapes/shared.tsx`

- [ ] **Step 1: Read `shared.tsx` to find the card-rendering primitive**

```bash
grep -n "opencanvas-card" app/src/canvas/shapes/shared.tsx
```

Identify the function/component that renders `<div className="opencanvas-card">` (or similar). It's the shared scaffold consumed by all 17 shape util files.

- [ ] **Step 2: Wrap the card root with `motion.div` + `useParallax`**

In `shared.tsx`, find the JSX that returns the card root element. Replace:

**Before** (representative):
```tsx
return (
  <div
    className="opencanvas-card"
    data-role={role}
    data-collapsed={collapsed}
    style={style}
  >
    {children}
  </div>
);
```

**After:**
```tsx
import { motion } from 'framer-motion';
import { useParallax } from '../../lib/motion/use-parallax';

// ... inside the component:

const { ref, rotateX, rotateY, translateZ, bind } = useParallax({ maxTilt: 3 });

return (
  <motion.div
    ref={ref as React.RefObject<HTMLDivElement>}
    {...bind}
    className="opencanvas-card"
    data-role={role}
    data-collapsed={collapsed}
    style={{
      ...style,
      rotateX,
      rotateY,
      z: translateZ,
      transformPerspective: 1200,
    }}
  >
    {children}
  </motion.div>
);
```

If `shared.tsx` uses a different pattern (e.g., a wrapper component named differently), adapt the same change to that component. The key invariants:
1. The element with `className="opencanvas-card"` gets the `useParallax` ref + bind handlers.
2. The `style` object includes `rotateX`, `rotateY`, `z: translateZ`, and `transformPerspective: 1200`.

- [ ] **Step 3: Run all app tests** (existing shape-util tests must still pass)

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass. If any tldraw/shape test fails, the most likely cause is `motion.div` changing the rendered DOM structure — verify the test selector still matches.

- [ ] **Step 4: Run typecheck**

```
pnpm exec tsc --noEmit -p app/tsconfig.json
```
Expected: clean.

- [ ] **Step 5: Visual smoke test — parallax on widget cards**

```
pnpm dev
```

Open http://127.0.0.1:3458. Place a widget. Hover the card with the pointer and move slowly across it. The card should tilt 1–3° toward the pointer with a smooth spring response. Pointer leave → card returns to neutral. Test with reduced motion enabled (System Preferences → Accessibility → Display → Reduce motion on macOS) — tilt should be disabled entirely. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add app/src/canvas/shapes/shared.tsx
git commit -m "feat(canvas): widget cards opt into useParallax (3° tilt + lift)"
```

---

### Task 11: Header chrome — consume depth tokens

**Files:**
- Modify: `app/src/styles/globals.css` (`.opencanvas-glass`, `.opencanvas-header-btn`, `.opencanvas-header-divider`)

- [ ] **Step 1: Update `.opencanvas-glass`**

In `globals.css`, find `.opencanvas-glass {` (around line 730). Replace its body:

**Before:**
```css
.opencanvas-glass {
  background: rgba(var(--color-glass-rgb), 0.7);
  border: 1px solid var(--color-line);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
}
```

**After:**
```css
.opencanvas-glass {
  background: rgb(var(--color-glass-rgb) / 0.62);
  border: 1px solid var(--color-line);
  backdrop-filter: var(--blur-thin);
  -webkit-backdrop-filter: var(--blur-thin);
  box-shadow: var(--depth-1-shadow);
}
```

(Per-theme overrides for `.opencanvas-glass` below this rule already swap `--color-glass-rgb` — no change needed there.)

- [ ] **Step 2: Update `.opencanvas-header-btn`**

Find `.opencanvas-header-btn {` (around line 1118). Update box-shadow and transition:

```css
.opencanvas-header-btn {
  /* …keep existing layout (padding, height, font, color)… */
  box-shadow: var(--depth-1-shadow);
  transition:
    background-color var(--dur-firm) var(--ease-firm),
    box-shadow var(--dur-firm) var(--ease-firm),
    color var(--dur-firm) var(--ease-firm);
}
```

And update the `:hover` rule (around line 1131):

```css
.opencanvas-header-btn:hover {
  /* …keep existing background/color tweaks… */
  box-shadow: var(--depth-2-shadow);
}
```

- [ ] **Step 3: Run app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 4: Visual smoke test**

```
pnpm dev
```

Boot the app, hover each header button. Buttons should pick up a noticeably larger shadow on hover (depth-2). Header strip itself reads as a coherent translucent band. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add app/src/styles/globals.css
git commit -m "feat(ui): header chrome consumes --depth-1/2 + glass-thin recipe"
```

---

### Task 12: Floating chat panel — recipe + titlebar parallax

**Files:**
- Modify: `app/src/styles/globals.css` (`.opencanvas-chat-floating`, `.opencanvas-chat-titlebar`)
- Modify: `app/src/components/FloatingChat.tsx`

- [ ] **Step 1: Update `.opencanvas-chat-floating` recipe in globals.css**

Find `.opencanvas-chat-floating {` (around line 1181). Update background + shadow + filter:

```css
.opencanvas-chat-floating {
  /* …keep existing layout (position, size, etc.)… */
  background: rgb(var(--color-glass-rgb) / 0.82);
  border: 1px solid var(--color-line);
  backdrop-filter: var(--blur-heavy);
  -webkit-backdrop-filter: var(--blur-heavy);
  box-shadow: var(--depth-3-shadow);
}
```

- [ ] **Step 2: Update streaming-state glow to use role token**

Find `.opencanvas-chat-floating[data-streaming='true'] {` (around line 1224). Replace any hard-violet glow values with role-soft:

```css
.opencanvas-chat-floating[data-streaming='true'] {
  box-shadow:
    var(--depth-3-shadow),
    0 0 24px -2px var(--role-color-soft, var(--role-primary-soft));
}
```

- [ ] **Step 3: Add `useParallax` to the titlebar in `FloatingChat.tsx`**

Open `app/src/components/FloatingChat.tsx`. Update imports (line 1):

**Before:**
```ts
import { motion, useMotionValue, useDragControls } from 'framer-motion';
```

**After:**
```ts
import { motion, useMotionValue, useDragControls } from 'framer-motion';
import { useParallax } from '../lib/motion/use-parallax';
```

Inside the `FloatingChat` component, add the parallax hook for the titlebar (after existing hooks like `useDragControls`):

```tsx
const titlebarParallax = useParallax({ maxTilt: 2, lift: false });
```

In the titlebar `<header>` element (around line 101), wrap with `motion.header` and attach the parallax:

**Before:**
```tsx
<header
  className="opencanvas-chat-titlebar"
  onPointerDown={(e) => { /* … */ }}
  onDoubleClick={(e) => { /* … */ }}
>
  {/* … titlebar contents … */}
</header>
```

**After:**
```tsx
<motion.header
  ref={titlebarParallax.ref as React.RefObject<HTMLElement>}
  className="opencanvas-chat-titlebar"
  onPointerDown={(e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragControls.start(e);
  }}
  onDoubleClick={(e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    x.set(0);
    y.set(0);
    setChatWindow({ dragX: 0, dragY: 0 });
  }}
  onPointerMove={titlebarParallax.bind.onPointerMove}
  onPointerLeave={titlebarParallax.bind.onPointerLeave}
  style={{
    rotateX: titlebarParallax.rotateX,
    rotateY: titlebarParallax.rotateY,
    transformPerspective: 1200,
  }}
>
  {/* … same titlebar contents as before … */}
</motion.header>
```

(Keep the existing `<span>`, `<ChatBrandMark>`, button children unchanged.)

- [ ] **Step 4: Run app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass — including any existing `Chat.smoke.test.tsx` tests.

- [ ] **Step 5: Visual smoke test**

```
pnpm dev
```

Boot the app. The chat panel should have heavier glass + a more pronounced shadow. Hover over the titlebar with the cursor — only the titlebar tilts subtly (2°), body stays flat. Drag the chat — drag still works exactly as before. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add app/src/styles/globals.css app/src/components/FloatingChat.tsx
git commit -m "feat(ui): chat panel — glass-heavy + depth-3 + titlebar parallax (2°)"
```

---

### Task 13: Command palette — recipe + parallax + spring

**Files:**
- Modify: `app/src/styles/globals.css` (`.opencanvas-cmdk-panel`, `.opencanvas-cmdk-row`)
- Modify: `app/src/components/CommandPalette.tsx`

- [ ] **Step 1: Update `.opencanvas-cmdk-panel` recipe**

In `globals.css`, find `.opencanvas-cmdk-panel {` (around line 1003). Update background, blur, shadow:

```css
.opencanvas-cmdk-panel {
  /* …keep existing layout (position, max-width, etc.)… */
  background: rgb(var(--color-glass-rgb) / 0.82);
  border: 1px solid var(--color-line);
  backdrop-filter: var(--blur-heavy);
  -webkit-backdrop-filter: var(--blur-heavy);
  box-shadow: var(--depth-3-shadow);
}
```

- [ ] **Step 2: Update `.opencanvas-cmdk-row` hover**

Find `.opencanvas-cmdk-row--active, .opencanvas-cmdk-row:hover {` (around line 1070). Add depth-2 + scale:

```css
.opencanvas-cmdk-row--active,
.opencanvas-cmdk-row:hover {
  /* …keep existing background tweaks… */
  box-shadow: var(--depth-2-shadow);
  transform: scale(1.005);
  transition:
    background-color var(--dur-firm) var(--ease-firm),
    box-shadow var(--dur-firm) var(--ease-firm),
    transform var(--dur-firm) var(--ease-firm);
}
```

- [ ] **Step 3: Add `useParallax` to the palette container**

Open `app/src/components/CommandPalette.tsx`. Update imports:

```ts
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '../lib/motion/springs';
import { useParallax } from '../lib/motion/use-parallax';
```

Inside the `CommandPalette` component body, add the parallax hook:

```tsx
const paletteParallax = useParallax({ maxTilt: 2 });
```

Find the `motion.div` for the panel (around line 325 — the one containing the search input and rows). Add the parallax bind + style:

**Before** (representative):
```tsx
<motion.div
  className="opencanvas-cmdk-panel"
  initial={{ opacity: 0, scale: 0.96 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.96 }}
  transition={{ duration: 0.14 }}
>
  {/* … */}
</motion.div>
```

**After:**
```tsx
<motion.div
  ref={paletteParallax.ref as React.RefObject<HTMLDivElement>}
  onPointerMove={paletteParallax.bind.onPointerMove}
  onPointerLeave={paletteParallax.bind.onPointerLeave}
  className="opencanvas-cmdk-panel"
  initial={{ opacity: 0, scale: 0.96 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.96 }}
  transition={spring.firm}
  style={{
    rotateX: paletteParallax.rotateX,
    rotateY: paletteParallax.rotateY,
    transformPerspective: 1200,
  }}
>
  {/* … */}
</motion.div>
```

- [ ] **Step 4: Run app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 5: Visual smoke test**

```
pnpm dev
```

Boot the app. Press ⌘K. Palette opens with spring physics (slight overshoot). Move the cursor across it — subtle 2° tilt. Hover a row — row picks up depth-2 shadow + tiny scale. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add app/src/styles/globals.css app/src/components/CommandPalette.tsx
git commit -m "feat(ui): command palette — glass-heavy + depth-3 + 2° parallax + spring open"
```

---

### Task 14: ConversationsSidebar → `<DepthPanel>`

**Files:**
- Modify: `app/src/components/ConversationsSidebar.tsx`

- [ ] **Step 1: Read the existing component to identify the boilerplate to remove**

```bash
wc -l app/src/components/ConversationsSidebar.tsx
```

Open the file. The `motion.div` (backdrop) + `motion.aside` (panel) scaffolding + ESC handler + click-outside logic come out. The actual conversation-list content stays.

- [ ] **Step 2: Replace the wrapper with `<DepthPanel>`**

Replace the entire component body (everything between `export function ConversationsSidebar(...)` and the matching closing `}`) with:

```tsx
import { DepthPanel } from './primitives';
// keep existing imports for content (icons, store hooks, etc.)

interface ConversationsSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function ConversationsSidebar({ open, onClose }: ConversationsSidebarProps) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="left"
      width="320px"
      ariaLabel="Conversations"
    >
      <ConversationListBody onClose={onClose} />
    </DepthPanel>
  );
}

/**
 * The actual list body — was inline in the old motion.aside.
 * Lifted into its own component so the wrapper is just <DepthPanel>.
 */
function ConversationListBody({ onClose }: { onClose: () => void }) {
  // … paste in the existing JSX that was inside <motion.aside> …
  // (header with title + close button, search input, list of conversations,
  //  any per-item actions, etc.)
}
```

The exact JSX for `ConversationListBody` is whatever was previously inside the `<motion.aside>` element — a header with title + a close X button, a search/filter input if present, the mapped list of conversations, and any actions. Preserve all behavior and store wiring as-is.

Remove from imports: `motion`, `AnimatePresence` (no longer used in this file).
Remove from the file: any `useEffect` that attaches an ESC handler — that's now `<DepthPanel>`'s job.

- [ ] **Step 3: Run app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 4: Run typecheck**

```
pnpm exec tsc --noEmit -p app/tsconfig.json
```
Expected: clean.

- [ ] **Step 5: Visual smoke test**

```
pnpm dev
```

Boot the app. Click the History (clock-back) button in the header. Drawer slides in from the left with spring physics. Click backdrop → closes. Open again, press ESC → closes. List rendering, search, item interactions — all unchanged. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/ConversationsSidebar.tsx
git commit -m "refactor(ui): ConversationsSidebar uses <DepthPanel>"
```

---

### Task 15: SourcesPanel → `<DepthPanel>`

**Files:**
- Modify: `app/src/components/SourcesPanel.tsx`

- [ ] **Step 1: Replace the wrapper with `<DepthPanel>`**

Same pattern as Task 14. Replace the body with:

```tsx
import { DepthPanel } from './primitives';
// keep existing content imports

interface SourcesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SourcesPanel({ open, onClose }: SourcesPanelProps) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="right"
      width="380px"
      ariaLabel="Knowledge sources"
    >
      <SourcesPanelBody onClose={onClose} />
    </DepthPanel>
  );
}

function SourcesPanelBody({ onClose }: { onClose: () => void }) {
  // paste existing JSX from inside the old motion.aside
}
```

Remove unused `motion`/`AnimatePresence` imports and the local ESC handler.

- [ ] **Step 2: Run app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 3: Visual smoke test**

```
pnpm dev
```

Boot the app. Click the KB badge to open Sources panel. Slides in from right. ESC closes. Backdrop closes. Source CRUD, KB stats — all unchanged. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/SourcesPanel.tsx
git commit -m "refactor(ui): SourcesPanel uses <DepthPanel>"
```

---

### Task 16: McpSourcesPanel → `<DepthPanel>`

**Files:**
- Modify: `app/src/components/McpSourcesPanel.tsx`

- [ ] **Step 1: Replace the wrapper with `<DepthPanel>`**

Same pattern. The MCP panel has more internal state (server editing, validation, status); preserve all of it inside the body sub-component.

```tsx
import { DepthPanel } from './primitives';
// keep all existing content imports + state hooks

interface McpSourcesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function McpSourcesPanel({ open, onClose }: McpSourcesPanelProps) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="right"
      width="420px"
      ariaLabel="MCP servers"
    >
      <McpSourcesPanelBody onClose={onClose} />
    </DepthPanel>
  );
}

function McpSourcesPanelBody({ onClose }: { onClose: () => void }) {
  // paste existing JSX + all internal state (useState calls, effects, etc.)
}
```

- [ ] **Step 2: Run app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 3: Visual smoke test**

```
pnpm dev
```

Boot the app. Click the server icon (header right side). MCP panel slides from right. Verify add/edit/remove server flows still work, validation still fires, status badges render. ESC closes. Backdrop closes. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/McpSourcesPanel.tsx
git commit -m "refactor(ui): McpSourcesPanel uses <DepthPanel>"
```

---

### Task 17: Per-theme visual review + sunset role-aura calibration if needed

**Files:**
- Possibly modify: `app/src/styles/globals.css` (sunset `--role-color-soft` opacities)

- [ ] **Step 1: Boot the app and cycle through all 4 themes**

```
pnpm dev
```

Open http://127.0.0.1:3458. The theme picker is currently disabled per `66c667b revert(theme): remove theme picker`, so cycle themes via DevTools console:

```js
document.documentElement.setAttribute('data-theme', 'dark')      // baseline
document.documentElement.setAttribute('data-theme', 'midnight')  // navy
document.documentElement.setAttribute('data-theme', 'sunset')    // warm
document.documentElement.setAttribute('data-theme', 'mono')      // grayscale
```

For each theme, place a few widgets with different roles and hover them:

```bash
curl -X POST http://localhost:3457/v1/canvas/widgets -H 'content-type: application/json' \
  -d '{"kind":"markdown","role":"primary","payload":{"body":"# Primary"}}'
curl -X POST http://localhost:3457/v1/canvas/widgets -H 'content-type: application/json' \
  -d '{"kind":"markdown","role":"timeline","payload":{"body":"# Timeline (rose)"}}'
curl -X POST http://localhost:3457/v1/canvas/widgets -H 'content-type: application/json' \
  -d '{"kind":"markdown","role":"reference","payload":{"body":"# Reference (amber)"}}'
```

- [ ] **Step 2: Inspect each theme for issues**

For each theme, check:
- Card hover aura reads cleanly (doesn't clash with the theme background).
- Glass surfaces have correct contrast (text isn't washed out).
- Header chrome reads as a coherent strip, not a transparent gap.
- Drawer panels look consistent with the rest of the chrome.

**Expected risk:** sunset's warm gradient + a violet `primary` aura may clash. If so, reduce `--role-primary-soft` opacity in the sunset block from 18% to 12% — see Step 3.

- [ ] **Step 3: (Conditional) Calibrate sunset role auras**

If the sunset theme shows clashing auras, in `app/src/styles/globals.css` find the `:root[data-theme='sunset']` block. Add a per-theme override of `--role-primary-soft` (and any other clashing role) at reduced opacity:

```css
:root[data-theme='sunset'] {
  /* …existing overrides… */
  --role-primary-soft:   rgba(167, 139, 250, 0.12); /* was 0.18 globally — softened for warm theme */
  --role-detail-soft:    rgba(96, 165, 250, 0.12);  /* same */
}
```

If no calibration is needed, skip this step.

- [ ] **Step 4: Re-verify all 4 themes**

Repeat Step 1's cycle. Confirm all themes look intentional. Stop dev server.

- [ ] **Step 5: Run all app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 6: Commit (only if calibration was needed in Step 3)**

```bash
git add app/src/styles/globals.css
git commit -m "fix(ui): soften role auras in sunset theme — depth-4 was clashing"
```

If no changes were needed, skip the commit.

---

### Task 18: Phase-2 verification + open PR

**Files:** none (verification only)

- [ ] **Step 1: Run all app tests**

```
pnpm exec vitest run --config app/vite.config.ts
```
Expected: all pass.

- [ ] **Step 2: Run all backend tests**

```
pnpm test
```
Expected: all pass.

- [ ] **Step 3: Run typecheck**

```
pnpm typecheck && pnpm exec tsc --noEmit -p app/tsconfig.json
```
Expected: clean.

- [ ] **Step 4: End-to-end smoke**

```
pnpm electron:dev
```

Verify in the Electron window:
- Boot is clean (no console errors).
- Place several widgets via the agent (or REST). Verify cards, hover tilt, role auras.
- Open & close all 3 drawers. Open & close palette.
- Drag the chat panel. Confirm titlebar tilts on pointer hover, drag still works.
- Cycle themes via DevTools (Step 1 of Task 17). All 4 themes present cleanly.
- Toggle reduced-motion in OS settings — confirm parallax disables.

Stop the app.

- [ ] **Step 5: Open Phase-2 PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(ui): modernise UI — phase 2 (surfaces)" --body "$(cat <<'EOF'
## Summary
- Widget cards — `--depth-2/4` recipe + 3° parallax + role-aura hover
- Header chrome — `--depth-1/2` + `glass-thin`
- Floating chat panel — `--depth-3` + `glass-heavy` + 2° titlebar parallax (body stays flat)
- Command palette — `--depth-3` + `glass-heavy` + 2° parallax + spring.firm open
- ConversationsSidebar / SourcesPanel / McpSourcesPanel → `<DepthPanel>` (≈505 lines removed)
- Per-theme calibration where needed

**Visual impact: full** — Phase 1 (#<phase-1-pr>) laid the foundation invisibly; this is the visible modernisation.

Spec: docs/superpowers/specs/2026-05-09-modernise-ui-design.md

## Test plan
- [ ] vitest passes (`pnpm exec vitest run --config app/vite.config.ts`)
- [ ] backend tests pass (`pnpm test`)
- [ ] typecheck clean (`pnpm typecheck && pnpm exec tsc --noEmit -p app/tsconfig.json`)
- [ ] Electron app boots, no console errors
- [ ] Widget cards tilt on hover (3°), aura blooms in role color
- [ ] Header chrome reads as cohesive translucent strip
- [ ] Chat panel drags; titlebar tilts subtly on hover (2°); body stays flat
- [ ] Command palette opens with spring; rows pick up shadow on hover
- [ ] All 3 drawers open/close — backdrop click closes, ESC closes
- [ ] All 4 themes (dark / midnight / sunset / mono) look intentional
- [ ] `prefers-reduced-motion` disables tilt entirely

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Phase 2 complete. Modernise-UI project done.**

---

## Notes for the implementing engineer

### Test conventions (matched from existing code)
- Tests live under `__tests__/app/`, NOT next to source.
- Imports go via relative path: `'../../app/src/...'`.
- Stores tested via `vi.resetModules()` + dynamic import (re-triggers init side effects).
- `localStorage.clear()` in `beforeEach`.
- `@testing-library/react` auto-cleans the DOM between tests — no manual teardown needed.
- Frontend run command: `pnpm exec vitest run --config app/vite.config.ts`.

### What you DON'T need to touch
- The 17 widget shape util files (`code-block.tsx`, `markdown.tsx`, `time.tsx`, etc.) — they all consume `.opencanvas-card` via `shared.tsx`, so the upgrade reaches them automatically.
- Tldraw integration code (`Canvas.tsx`, `dispatcher.ts`, `stream-mutator.ts`).
- Backend, agent, MCP, REST API.
- Tier 3 surfaces (toasts, badges, empty states) — explicitly out of scope.

### If a step's "Before" code doesn't exactly match the file
The "Before" snippets in this plan are representative but may not match every detail of the current file (e.g., property order, comment placement). Use the snippets as a guide for *what to change to*, not a strict text match. The "After" snippets are exact.

### If existing tests break unexpectedly
Most likely cause is the `motion.div` wrapper changing the rendered DOM tree in shape-util tests. Fix by updating the test selector to traverse one level deeper, or by using `getByRole` / `getByTestId` instead of brittle structural selectors.
