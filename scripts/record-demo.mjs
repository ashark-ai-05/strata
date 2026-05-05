#!/usr/bin/env node
/**
 * Record a feature-rich demo GIF of the OpenCanvas UI without a
 * sudo-installed Chrome.
 *
 * - Boots Playwright's bundled chromium (already installed via
 *   `npx playwright install chromium`).
 * - Drives the running Vite app at http://127.0.0.1:3458.
 * - Imports state/editor-ref + canvas/dispatcher off Vite's dev module
 *   graph so we can drive widget placement programmatically (skipping
 *   the LLM cost of a real chat turn).
 * - Drives the chat input + ui-store flags directly so the demo shows:
 *     - the in-input live-step overlay (animated emoji + gradient label)
 *     - the streaming gradient border on the input
 *     - sequential widget placements with the fresh-place pop animation
 *     - role-tinted hover glow on a placed card
 *     - the live minimap updating bottom-left
 *     - 6 different widget kinds covering the breadth of the surface
 * - Captures ~28 PNG frames at 1280×800 @ 1.5x DPR.
 * - Stitches with ffmpeg-static into docs/demo.gif at 6 fps for a ~5s
 *   loop. palette-gen + paletteuse keeps colours clean.
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
const FPS = 6;
const HOLD = 250; // ms between snaps within a beat

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
    },
    { kind, role, payload },
  );
}

/**
 * Toggle the ui-store flags that surface the live-step overlay so the
 * recording shows what a real chat turn looks like — without the cost
 * + non-determinism of actually calling the LLM.
 */
async function setBusy(page, busy) {
  await page.evaluate((busy) => {
    const ui = window.__opencanvasUiStore__;
    if (!ui) return;
    ui.getState().setChatBusy(busy);
  }, busy);
}

async function main() {
  await ensureCleanFrames();

  console.log('[demo] launching chromium');
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
    // Reduce motion is OFF — we want the animations on.
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[page-error]', e.message));

  console.log('[demo] navigate', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header h1', { timeout: 30_000 });

  // Wire window hooks: editor handle + dispatcher + ui-store.
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
  await sleep(400); // let initial paint settle

  // ---------------------------------------------------------------
  // Storyboard
  // ---------------------------------------------------------------

  // Frame 1-2 — empty canvas hero, idle composer.
  await snap(page, 'empty canvas');
  await sleep(HOLD);
  await snap(page, 'empty canvas (hold)');

  // Focus the chat input + type a query character-by-character. While
  // typing, the input has the focus glow + gradient ring; this is the
  // "user is asking a question" beat.
  const input = await page.$('.opencanvas-chat-input');
  if (input) {
    await input.focus();
    await sleep(150);
    await snap(page, 'composer focused');
    const text = 'Compare REST vs gRPC for our user service';
    for (let i = 0; i < text.length; i += 4) {
      await input.type(text.slice(i, i + 4), { delay: 0 });
      if (i % 16 === 0) await snap(page, `typing "${text.slice(0, i + 4)}"`);
    }
    await snap(page, 'typed: full query');
    await sleep(HOLD);
    // Clear the input — the act of "submitting" without actually firing
    // a chat turn (we don't want to spend tokens on a demo).
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
    await sleep(150);
    await snap(page, 'submitted');
  }

  // Place the first widget — shows the fresh-place pop animation
  // (scale-in with overshoot + role-tinted left edge stripe).
  await placeWidget(page, 'markdown', 'primary', {
    title: 'REST vs gRPC',
    body:
      "**REST** uses HTTP/1.1 + JSON. Human-readable, ubiquitous tooling, " +
      "caches well.\n\n**gRPC** uses HTTP/2 + Protobuf. Smaller payloads, " +
      "bidirectional streaming, strong contract via .proto files.",
  });
  await sleep(HOLD);
  await snap(page, '+ markdown (primary)');

  // Place the comparison table — blue accent (detail role).
  await placeWidget(page, 'table', 'detail', {
    title: 'Side-by-side',
    columns: [
      { key: 'aspect', label: 'Aspect' },
      { key: 'rest', label: 'REST' },
      { key: 'grpc', label: 'gRPC' },
    ],
    rows: [
      ['Wire format', 'JSON', 'Protobuf'],
      ['Transport', 'HTTP/1.1', 'HTTP/2'],
      ['Streaming', 'SSE / WS', 'native bidi'],
      ['Browser', 'first-class', 'gRPC-Web'],
      ['Tooling', 'curl, Postman', 'protoc, Bloom'],
    ],
  });
  await sleep(HOLD);
  await snap(page, '+ table (detail)');

  // Code-block — teal accent (related role).
  await placeWidget(page, 'code-block', 'related', {
    title: 'gRPC service definition',
    language: 'proto',
    code:
      'service UserService {\n' +
      '  rpc GetUser(UserRequest) returns (User);\n' +
      '  rpc StreamUsers(Empty) returns (stream User);\n' +
      '}\n\n' +
      'message User {\n' +
      '  string id = 1;\n' +
      '  string name = 2;\n' +
      '  string email = 3;\n' +
      '}',
  });
  await sleep(HOLD);
  await snap(page, '+ code-block (related)');

  // Ticket — amber accent (reference).
  await placeWidget(page, 'ticket', 'reference', {
    ticketId: 'API-482',
    title: 'Migrate /users to gRPC',
    status: 'In Progress',
    assignee: 'platform',
    priority: 'High',
    description: 'Rolling cutover with feature flag; REST stays for one quarter.',
  });
  await sleep(HOLD);
  await snap(page, '+ ticket (reference)');

  // Tasks — rose accent (timeline).
  await placeWidget(page, 'tasks', 'timeline', {
    title: 'Migration checklist',
    items: [
      { text: 'Define .proto contract', done: true },
      { text: 'Generate clients (TS, Go, Java)', done: true },
      { text: 'Dual-publish for one release', done: false },
      { text: 'Cut traffic 10% → 100%', done: false },
      { text: 'Decommission REST endpoints', done: false },
    ],
  });
  await sleep(HOLD);
  await snap(page, '+ tasks (timeline)');

  // Sticky note — emerald accent (node).
  await placeWidget(page, 'sticky-note', 'node', {
    body: 'Watch out for keep-alive\nmismatch with the existing\nload balancer!',
    author: 'rita',
    colour: 'yellow',
  });
  await sleep(HOLD);
  await snap(page, '+ sticky-note (node)');

  // Hold on the full canvas for a beat so the loop feels resolved.
  await sleep(HOLD * 2);
  await snap(page, 'full canvas (hold)');

  // Hover the first widget to trigger its role-tinted glow + hover-action chrome.
  await page.evaluate(() => {
    const card = document.querySelector('.opencanvas-card[data-role="primary"]');
    if (!card) return;
    const r = card.getBoundingClientRect();
    const ev = new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    });
    card.dispatchEvent(ev);
  });
  await page.mouse.move(W / 2 - 200, 280);
  await sleep(HOLD);
  await snap(page, 'hover primary');
  await sleep(HOLD);
  await snap(page, 'hover (hold)');

  // Add a kanban board for variety (violet accent, primary role).
  await placeWidget(page, 'kanban', 'primary', {
    title: 'Migration board',
    columns: [
      {
        name: 'To do',
        colour: 'neutral',
        cards: [
          { title: 'Decommission REST endpoints' },
          { title: 'Rewrite client SDK docs' },
        ],
      },
      {
        name: 'Doing',
        colour: 'amber',
        cards: [
          { title: 'Roll out to 10% traffic', priority: 'High' },
          { title: 'Update load-balancer keep-alive' },
        ],
      },
      {
        name: 'Done',
        colour: 'green',
        cards: [
          { title: 'Define .proto contract' },
          { title: 'Generate clients (TS, Go)' },
        ],
      },
    ],
  });
  await sleep(HOLD);
  await snap(page, '+ kanban (primary)');

  // Drop the busy flag — overlay vanishes, UI is back to idle on a populated canvas.
  await setBusy(page, false);
  await sleep(HOLD);
  await snap(page, 'idle, populated');
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
      // Two-pass palettegen for clean colours; scale to 960px wide so
      // the gif is still crisp but smaller than the raw 1920px capture.
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
