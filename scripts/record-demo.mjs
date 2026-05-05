#!/usr/bin/env node
/**
 * Record a slow, content-rich demo GIF of OpenCanvas.
 *
 * Storyboard: a user asks "How is OpenCanvas built?" and the agent
 * progressively places a coherent set of widgets — a markdown
 * overview, a deep file-tree, a composite multi-section card, a
 * timeline of releases, a kanban board, and a live code-block — that
 * together explain the architecture. Each placement gets a beat for
 * the fresh-place pop animation to read; tweens are paced so the
 * loop doesn't feel hurried.
 *
 * - Boots Playwright's bundled chromium (no system Chrome / sudo).
 * - Imports state/editor-ref + canvas/dispatcher off Vite's dev
 *   module graph; widgets land via `applyToolDirective` so the demo
 *   doesn't spend tokens on a real chat turn.
 * - Collapses the floating chat after the typing beat so the canvas
 *   becomes the visual hero, then reopens it for a final shot.
 * - Captures ~30+ PNG frames at 1280×800 @ 1.5x DPR.
 * - Stitches with ffmpeg-static into docs/demo.gif at 4 fps for a
 *   ~10s loop.
 *
 * Run:
 *   pnpm dev              # in another terminal
 *   node scripts/record-demo.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = join(REPO, 'docs', 'demo-frames');
const GIF_PATH = join(REPO, 'docs', 'demo.gif');
const APP_URL = 'http://127.0.0.1:3458/';
const FFMPEG = (await import('ffmpeg-static')).default;
const W = 1280;
const H = 800;
const FPS = 4;        // playback rate of the gif (one frame every 250ms)
const HOLD = 280;     // ms between snaps within a beat
const BIG_HOLD = 700; // hero / fresh-place beats

async function ensureCleanFrames() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const f of await readdir(OUT_DIR)) {
    if (f.endsWith('.png')) await unlink(join(OUT_DIR, f));
  }
}

let frameNo = 0;
async function snap(page, label) {
  const file = join(OUT_DIR, `frame-${String(++frameNo).padStart(3, '0')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[demo] frame ${frameNo}: ${label}`);
  return file;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function placeWidget(page, kind, role, payload) {
  await page.evaluate(
    ({ kind, role, payload }) => {
      const editor = window.__opencanvasEditorForDemo__;
      const dispatcher = window.__opencanvasDispatcher__;
      if (!editor || !dispatcher) throw new Error('demo hooks missing');
      const id = crypto.randomUUID();
      dispatcher(editor, { type: 'place', id, kind, role, payload }, 'ask-anything');
      // Track the growing cluster: re-fit after every placement so the
      // camera always shows the latest addition + everything before it.
      // Zoom is animated so the gif gets a satisfying re-frame between
      // beats. inset:80 keeps a comfortable margin around the widgets.
      editor.zoomToFit({ animation: { duration: 300 }, inset: 80 });
    },
    { kind, role, payload },
  );
}

async function setChatWindow(page, patch) {
  await page.evaluate((patch) => {
    const ui = window.__opencanvasUiStore__;
    if (!ui) return;
    ui.getState().setChatWindow(patch);
  }, patch);
}

async function main() {
  await ensureCleanFrames();

  console.log('[demo] launching chromium');
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[page-error]', e.message));

  console.log('[demo] navigate', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header h1', { timeout: 30_000 });

  // Wire window hooks for direct control.
  await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 12_000) {
      try {
        const editorRef = await import('/src/state/editor-ref.ts');
        const dispatcherMod = await import('/src/canvas/dispatcher.ts');
        const uiMod = await import('/src/state/ui-store.ts');
        const editor = editorRef.getEditor();
        if (editor) {
          window.__opencanvasEditorForDemo__ = editor;
          window.__opencanvasDispatcher__ = dispatcherMod.applyToolDirective;
          window.__opencanvasUiStore__ = uiMod.useUiStore;
          return;
        }
      } catch {
        /* canvas not ready yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('editor never appeared');
  });
  await sleep(500);

  // ---------------------------------------------------------------
  // Beat 1 — empty canvas hero (3 frames, slow open)
  // ---------------------------------------------------------------
  await snap(page, 'empty canvas');
  await sleep(HOLD);
  await snap(page, 'empty canvas (hold)');
  await sleep(HOLD);
  await snap(page, 'empty canvas (settle)');

  // ---------------------------------------------------------------
  // Beat 2 — focus chat + animated typing (slow, ~6 frames)
  // ---------------------------------------------------------------
  const input = await page.$('.opencanvas-chat-input');
  if (input) {
    await input.focus();
    await sleep(HOLD);
    await snap(page, 'composer focused');
    const text = 'How is OpenCanvas built?';
    let buffer = '';
    for (let i = 0; i < text.length; i++) {
      buffer += text[i];
      await input.type(text[i], { delay: 0 });
      // Snap every ~5 chars for a perceptibly-slow typing animation.
      if ((i + 1) % 5 === 0 || i === text.length - 1) {
        await sleep(160);
        await snap(page, `typing "${buffer}"`);
      }
    }
    await sleep(HOLD);
    // "Submit" — clear the input via React-aware setter.
    await page.evaluate(() => {
      const el = document.querySelector('.opencanvas-chat-input');
      if (!(el instanceof HTMLInputElement)) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(HOLD);
    await snap(page, 'submitted');
  }

  // ---------------------------------------------------------------
  // Beat 3 — collapse chat → canvas becomes hero
  // ---------------------------------------------------------------
  await setChatWindow(page, { mode: 'collapsed' });
  await sleep(HOLD);
  await snap(page, 'chat collapsed');

  // ---------------------------------------------------------------
  // Beat 4 — sequential rich placements. Each widget gets two
  // snapshots: one immediately (fresh-place pop) and one after a
  // longer beat (settled card with role-tinted glow).
  // ---------------------------------------------------------------

  // Markdown — primary, violet edge.
  await placeWidget(page, 'markdown', 'primary', {
    title: 'OpenCanvas — at a glance',
    body:
      'A local desktop knowledge surface. The agent **searches** your KB, the web, and any MCP source you wire up — then **places typed widgets** on a tldraw canvas to build the answer spatially. Every conversation indexes back, so search compounds with use.',
  });
  await sleep(HOLD);
  await snap(page, '+ markdown (pop)');
  await sleep(BIG_HOLD);
  await snap(page, 'markdown (settled)');

  // File-tree — detail, blue edge. Real repo structure.
  await placeWidget(page, 'file-tree', 'detail', {
    title: 'src/ — backend',
    root: {
      name: 'src',
      type: 'directory',
      children: [
        {
          name: 'agent',
          type: 'directory',
          children: [
            { name: 'tools/', type: 'directory', meta: '11 tools' },
            { name: 'payloads.ts', type: 'file' },
            { name: 'types.ts', type: 'file' },
          ],
        },
        {
          name: 'backend',
          type: 'directory',
          children: [
            { name: 'routes/', type: 'directory', meta: '14 routes' },
            { name: 'server.ts', type: 'file' },
            { name: 'state.ts', type: 'file' },
            { name: 'uims-stream.ts', type: 'file' },
          ],
        },
        {
          name: 'connectors',
          type: 'directory',
          children: [
            { name: 'code.ts', type: 'file' },
            { name: 'jira.ts', type: 'file' },
            { name: 'stash.ts', type: 'file' },
            { name: 'confluence.ts', type: 'file' },
          ],
        },
        {
          name: 'indexer',
          type: 'directory',
          children: [
            { name: 'orchestrator.ts', type: 'file' },
            { name: 'qa-enricher.ts', type: 'file' },
            { name: 'link-extractor.ts', type: 'file' },
          ],
        },
        { name: 'providers/', type: 'directory', meta: '6 adapters' },
      ],
    },
  });
  await sleep(HOLD);
  await snap(page, '+ file-tree (pop)');
  await sleep(BIG_HOLD);
  await snap(page, 'file-tree (settled)');

  // Composite — primary, stacks under the markdown card in column 0.
  await placeWidget(page, 'composite', 'primary', {
    title: 'Architecture · stack + numbers',
    sections: [
      {
        heading: 'Stack',
        kind: 'key-value-card',
        payload: {
          title: '',
          fields: [
            { key: 'Backend', value: 'Hono + better-sqlite3 + sqlite-vec' },
            { key: 'Agent SDK', value: 'Claude Agent SDK (in-process MCP)' },
            { key: 'Frontend', value: 'Vite + React 19 + tldraw 3' },
            { key: 'Streaming', value: 'AI SDK 6 UIMS' },
            { key: 'Desktop', value: 'Electron 39 + electron-builder' },
          ],
        },
      },
      {
        heading: 'Surface',
        kind: 'key-value-card',
        payload: {
          title: '',
          fields: [
            { key: 'Widget kinds', value: '12' },
            { key: 'Agent tools', value: '11 (in-process MCP)' },
            { key: 'KB connectors', value: 'code · jira · stash · confluence' },
            { key: 'LLM providers', value: '6' },
            { key: 'Embedders', value: 'onnx · openai · voyage · ollama' },
          ],
        },
      },
      {
        heading: 'Where the magic is',
        kind: 'markdown',
        payload: {
          title: '',
          body:
            'Hybrid retrieval: **FTS5 BM25 + sqlite-vec MATCH**, fused via reciprocal rank (k=60). The QA enricher embeds the **12 hypothetical user queries** generated per chunk — biases the vector subspace toward how users phrase questions.',
        },
      },
    ],
  });
  await sleep(HOLD);
  await snap(page, '+ composite (pop)');
  await sleep(BIG_HOLD);
  await snap(page, 'composite (settled)');

  // Timeline — release history. Reuse the 'detail' role so it stacks
  // under the file-tree (keeps the layout tight in column 1 instead
  // of scattering across 6 role columns).
  await placeWidget(page, 'timeline', 'detail', {
    title: 'Recent releases',
    events: [
      {
        timestamp: '2026-01',
        label: 'v0.0.0 · spec replication',
        body: '22-section build spec ported to working code.',
        kind: 'release',
      },
      {
        timestamp: '2026-02',
        label: 'Phase 1–6 · backend + frontend',
        body: 'Provider rename, KB pipeline, 12 widget kinds.',
        kind: 'commit',
      },
      {
        timestamp: '2026-03',
        label: 'UI polish · gradients + glows',
        body: 'Brand gradient, role-tinted card hover, in-input live-step overlay.',
        kind: 'commit',
      },
      {
        timestamp: '2026-04',
        label: 'Live progress + composer status',
        body: 'KB hits chip, live-step renders inside the input box itself.',
        kind: 'commit',
      },
      {
        timestamp: '2026-05',
        label: 'Rename → OpenCanvas + dependabot zero',
        body: 'Brand rename, electron 39 bump, all alerts resolved.',
        kind: 'release',
      },
    ],
  });
  await sleep(HOLD);
  await snap(page, '+ timeline (pop)');
  await sleep(BIG_HOLD);
  await snap(page, 'timeline (settled)');

  // Kanban — feature progress. Sits in 'related' (column 2) so the
  // three-column cluster is tight and readable in the hero shot.
  await placeWidget(page, 'kanban', 'related', {
    title: 'Roadmap',
    columns: [
      {
        name: 'To do',
        colour: 'neutral',
        cards: [
          { title: 'Voice input mode', priority: 'Medium' },
          { title: 'Per-widget annotations', tag: 'UX' },
          { title: 'Mobile companion view' },
        ],
      },
      {
        name: 'Doing',
        colour: 'amber',
        cards: [
          { title: 'Agentic export → Notion', priority: 'High' },
          { title: 'Markdown rendering polish', tag: 'styling' },
        ],
      },
      {
        name: 'Done',
        colour: 'green',
        cards: [
          { title: 'KB hits panel' },
          { title: 'Floating chat' },
          { title: 'Mini-map' },
        ],
      },
    ],
  });
  await sleep(HOLD);
  await snap(page, '+ kanban (pop)');
  await sleep(BIG_HOLD);
  await snap(page, 'kanban (settled)');

  // Code-block — also in 'related' so it stacks under the kanban.
  await placeWidget(page, 'code-block', 'related', {
    title: 'src/agent/tools/place-widget.ts',
    language: 'typescript',
    code:
      "export function placeWidgetTool(): PlaceWidgetToolDef {\n" +
      "  return tool(\n" +
      "    'place_widget',\n" +
      "    /* description … */,\n" +
      "    inputShape,\n" +
      "    async (args) => {\n" +
      "      const validated = validatePayloadForKind(\n" +
      "        args.kind, args.payload\n" +
      "      );\n" +
      "      const id = randomUUID();\n" +
      "      return { ok: true, id, directive: {\n" +
      "        type: 'place', id, kind: args.kind,\n" +
      "        role: args.role, payload: validated,\n" +
      "      } };\n" +
      "    },\n" +
      "  );\n" +
      "}",
  });
  await sleep(HOLD);
  await snap(page, '+ code-block (pop)');
  await sleep(BIG_HOLD);
  await snap(page, 'code-block (settled)');

  // ---------------------------------------------------------------
  // Beat 5 — expand any cards the dispatcher auto-collapsed
  // (COLLAPSE_THRESHOLD=3 makes the 4th+ widget start at 44px). For
  // the demo we want every card readable, so we mass-expand and
  // re-fit the camera before the hero shot.
  // ---------------------------------------------------------------
  await page.evaluate(() => {
    const editor = window.__opencanvasEditorForDemo__;
    const shapes = editor.getCurrentPageShapes();
    for (const s of shapes) {
      if (!s.type.startsWith('opencanvas:')) continue;
      const meta = (s.meta ?? {});
      if (meta.collapsed) {
        const h = meta.expandedHeight ?? 200;
        editor.updateShape({
          id: s.id,
          type: s.type,
          props: { ...s.props, h },
          meta: { ...meta, collapsed: false },
        });
      }
    }
    editor.zoomToFit({ animation: { duration: 400 }, inset: 60 });
  });
  await sleep(700);
  await snap(page, 'expanded all (hero 1)');
  await sleep(BIG_HOLD);
  await snap(page, 'full canvas (hero 2)');

  // Re-open chat for the final beat — emphasises that asking + result
  // co-exist visually.
  await setChatWindow(page, { mode: 'open' });
  await sleep(HOLD);
  await snap(page, 'chat reopened');
  await sleep(HOLD);
  await snap(page, 'final hero');

  await browser.close();

  // ---- Stitch ----
  console.log('[demo] stitching →', GIF_PATH);
  await new Promise((res, rej) => {
    const args = [
      '-y',
      '-framerate', String(FPS),
      '-i', join(OUT_DIR, 'frame-%03d.png'),
      '-vf',
      'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
      '-loop', '0',
      GIF_PATH,
    ];
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) =>
      code === 0 ? res(undefined) : rej(new Error(`ffmpeg exit ${code}`)),
    );
  });

  if (!existsSync(GIF_PATH)) throw new Error('demo.gif not produced');
  console.log('[demo] done →', GIF_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
