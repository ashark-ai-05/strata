# Plan 1.7 — Chat Hook Format Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the format gap between our backend's `/v1/query` (`ProviderEvent` SSE) and space-agent's chat consumer (OpenAI chat-completions SSE). Add a new `/v1/query/openai` endpoint that wraps our stream in OpenAI format, then update the customware chat hook to actually redirect space-agent's chat request through it. End result: typing in space-agent's browser chat invokes whatever LLM the active llm-wiki profile is configured to use.

**Architecture:** A small adapter (`src/backend/openai-stream.ts`) converts our `ProviderEvent` async iterable into OpenAI chat-completions SSE chunks (`data: {"choices":[{"delta":{"content":"..."}}]}`). A new POST `/v1/query/openai` endpoint takes the OpenAI-shaped request (`{messages, model, ...}`), extracts the user's prompt, calls our `LLMProvider`, and streams back via the adapter. The customware hook (Task 9 of Plan 1.6) is upgraded from "scaffold + annotate" to "actually redirect `request.requestUrl` to our endpoint when the backend is healthy."

**Tech Stack:** Same as Plan 1.6 — Hono, existing LLMProvider, customware extension JS. No new deps.

**References:**
- Plan 1.6: `docs/superpowers/plans/2026-05-02-plan-1-6-wire-it-together.md` — Task 9 "best-effort scaffold" outcome and the documented format gap
- Spike 05: `docs/superpowers/spikes/05-space-agent-fork.md` — `prepareOnscreenAgentApiRequest/end` is the seam; `open_router/` is the canonical reference module

**Out of scope:**
- Tool calls / function calling (the chat surface isn't using tools yet; defer to a later plan when we wire MCP-as-agent-context)
- Streaming `thinking-delta` events to space-agent's UI (those become OpenAI `reasoning_content` chunks; not all consumers handle that — defer until needed)
- Auth on the backend (still localhost-only)

---

## File structure

### New files

```
src/
  backend/
    openai-stream.ts           # adapt ProviderEvent → OpenAI SSE chunks
    routes/
      query-openai.ts          # POST /v1/query/openai
__tests__/
  openai-stream.test.ts        # unit-tests the adapter
```

### Modified files

```
src/backend/server.ts          # mount the new route
customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/prepareOnscreenAgentApiRequest/end/llm-wiki.js
                               # actually redirect requestUrl + body when backend healthy
README.md                      # note that chat in space-agent uses llm-wiki backend now
__tests__/backend.test.ts      # cover /v1/query/openai endpoint
```

### Files NOT touched

`src/core/**`, `src/providers/**`, `src/embedders/**`, `src/storage/**`, `src/mcp/**`, `src/search/**`, `src/indexer/**` — the backend's data path is the only thing that changes.

---

## Task 0: ProviderEvent → OpenAI SSE adapter

**Files:**
- Create: `src/backend/openai-stream.ts`
- Test: `__tests__/openai-stream.test.ts`

OpenAI's chat completions SSE shape:

```
data: {"id":"...","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}
data: {"id":"...","choices":[{"index":0,"delta":{"content":"Hello"}}]}
data: {"id":"...","choices":[{"index":0,"delta":{"content":" world"}}]}
data: {"id":"...","choices":[{"index":0,"finish_reason":"stop","delta":{}}]}
data: [DONE]
```

We map our `ProviderEvent` types as follows:
- `text-delta` → `{delta: {content: text}}`
- `done` → `{finish_reason: 'stop', delta: {}}`, then `[DONE]`
- `error` → emit nothing (error flows through HTTP status / a final OpenAI-shaped error chunk if required by the consumer; for now, swallow + log)
- `thinking-delta`, `tool-call`, `tool-result` → ignored in v1 (chat surface doesn't use them)

- [ ] **Step 1: Write the failing test**

Create `__tests__/openai-stream.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { providerEventsToOpenAI } from '../src/backend/openai-stream.js';
import type { ProviderEvent } from '../src/core/provider.js';

async function* gen(events: ProviderEvent[]): AsyncIterable<ProviderEvent> {
  for (const e of events) yield e;
}

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('providerEventsToOpenAI', () => {
  it('emits a role-assistant opener, text deltas, finish, and [DONE]', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'done' },
      ]))
    );

    // Each line is a complete `data: ...\n\n` SSE block
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out[0]).toMatch(/"role":\s*"assistant"/);
    expect(out[0]).toMatch(/"delta":\s*\{[^}]*"role":\s*"assistant"/);

    const concatenated = out.join('');
    expect(concatenated).toContain('"content":"Hello"');
    expect(concatenated).toContain('"content":" world"');
    expect(concatenated).toContain('"finish_reason":"stop"');
    expect(concatenated.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('uses a stable id across all chunks of one stream', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([
        { type: 'text-delta', text: 'a' },
        { type: 'text-delta', text: 'b' },
        { type: 'done' },
      ]))
    );

    const ids = out
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)) as { id: string })
      .map((j) => j.id);

    expect(ids.length).toBeGreaterThan(0);
    const unique = new Set(ids);
    expect(unique.size).toBe(1);
  });

  it('ignores thinking-delta, tool-call, tool-result events', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([
        { type: 'thinking-delta', text: 'thinking…' },
        { type: 'tool-call', name: 'foo', input: {} },
        { type: 'tool-result', name: 'foo', output: 'bar' },
        { type: 'text-delta', text: 'final' },
        { type: 'done' },
      ]))
    );

    const concatenated = out.join('');
    expect(concatenated).toContain('"content":"final"');
    expect(concatenated).not.toContain('thinking');
    expect(concatenated).not.toContain('tool_call');
  });

  it('handles empty stream (no text-delta) gracefully', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([{ type: 'done' }]))
    );
    // Still emits the role opener + finish + [DONE]
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.join('')).toContain('"finish_reason":"stop"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test openai-stream
```

Expected: FAIL — `openai-stream.js` not found.

- [ ] **Step 3: Implement the adapter**

Create `src/backend/openai-stream.ts`:

```typescript
import type { ProviderEvent } from '../core/provider.js';

const MODEL_LABEL = 'llm-wiki';

/**
 * Convert our ProviderEvent stream into OpenAI chat-completions SSE
 * chunks. Each yielded string is a complete SSE block ready to write
 * directly to the response (already includes trailing `\n\n`).
 */
export async function* providerEventsToOpenAI(
  events: AsyncIterable<ProviderEvent>
): AsyncIterable<string> {
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const created = Math.floor(Date.now() / 1000);

  function chunk(delta: Record<string, unknown>, finishReason?: string): string {
    const payload: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: MODEL_LABEL,
      choices: [
        {
          index: 0,
          delta,
          ...(finishReason ? { finish_reason: finishReason } : {}),
        },
      ],
    };
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  // Opening chunk: assistant role
  yield chunk({ role: 'assistant', content: '' });

  for await (const event of events) {
    switch (event.type) {
      case 'text-delta':
        if (event.text) yield chunk({ content: event.text });
        break;
      case 'done':
        yield chunk({}, 'stop');
        break;
      case 'error':
        // Best-effort: log to stderr; consumers see the truncated stream.
        // OpenAI's spec doesn't define an in-stream error chunk that all
        // consumers handle; we rely on HTTP-level errors before the
        // stream starts and graceful truncation otherwise.
        console.error('[openai-stream] provider error:', event.message);
        yield chunk({}, 'stop');
        break;
      // thinking-delta, tool-call, tool-result are intentionally dropped in v1
    }
  }

  yield 'data: [DONE]\n\n';
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test openai-stream
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/openai-stream.ts __tests__/openai-stream.test.ts
git commit -m "feat(backend): providerEventsToOpenAI adapter for chat-completions SSE"
```

---

## Task 1: POST /v1/query/openai endpoint

**Files:**
- Create: `src/backend/routes/query-openai.ts`
- Modify: `src/backend/server.ts`
- Modify: `__tests__/backend.test.ts`

OpenAI chat completions request shape:

```json
{
  "model": "...",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

We extract the last user message as the prompt, the system message (if any) as `systemPrompt`, and call our `LLMProvider` regardless of the requested `model` (the user's active llm-wiki profile decides the actual model). Stream back via the OpenAI adapter.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/backend.test.ts`:

```typescript
describe('POST /v1/query/openai', () => {
  it('returns 400 when messages array is missing or empty', async () => {
    const r1 = await app.request('/v1/query/openai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(400);

    const r2 = await app.request('/v1/query/openai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    expect(r2.status).toBe(400);
  });

  it('returns 400 when no user message is present', async () => {
    const res = await app.request('/v1/query/openai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: 'be helpful' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with text/event-stream when a user message is present', async () => {
    const res = await app.request('/v1/query/openai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are a calculator.' },
          { role: 'user', content: 'What is 2+2?' },
        ],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route**

Create `src/backend/routes/query-openai.ts`:

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { providerEventsToOpenAI } from '../openai-stream.js';
import type { BackendState } from '../state.js';

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | { type: string; text?: string }[];
};

function extractText(content: OpenAIMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
  }
  return '';
}

export function queryOpenAIRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/query/openai', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: OpenAIMessage[];
      stream?: boolean;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }

    // Find the last user turn → that's the prompt.
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return c.json({ error: 'at least one user message is required' }, 400);
    }
    const prompt = extractText(lastUser.content);

    // Extract any system message (use the LAST one if multiple).
    const systemMsg = [...body.messages].reverse().find((m) => m.role === 'system');
    const systemPrompt = systemMsg ? extractText(systemMsg.content) : undefined;

    return streamSSE(c, async (stream) => {
      const provider = state.getLLMProvider();
      const events = provider.query({ prompt, systemPrompt });
      for await (const sseLine of providerEventsToOpenAI(events)) {
        // streamSSE adds its own framing; sseLine already includes
        // `data: ...\n\n`. We use writeRaw to bypass extra framing.
        await stream.writeRaw(sseLine);
      }
    });
  });

  return r;
}
```

- [ ] **Step 4: Mount the route in `src/backend/server.ts`**

Read `src/backend/server.ts`. Per the report from Plan 1.6 execution, routes are inlined directly. Add the new route the same way.

Add the import:

```typescript
import { queryOpenAIRoute } from './routes/query-openai.js';
```

Find the lazy-mount middleware (or the `start()` function) and add `app.route('/', queryOpenAIRoute(state));` alongside the other routes.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: PASS, including the three new `/v1/query/openai` tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/routes/query-openai.ts src/backend/server.ts __tests__/backend.test.ts
git commit -m "feat(backend): POST /v1/query/openai — accepts OpenAI request, streams OpenAI SSE"
```

---

## Task 2: Customware chat hook — actually redirect

**Files:**
- Modify: `customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/prepareOnscreenAgentApiRequest/end/llm-wiki.js`

Plan 1.6 left this as a "scaffold + annotate" with a fall-through. Now we make it actually redirect.

Per the Plan 1.6 execution report: the hook receives `hookContext.result` containing `{ apiEndpoint, headers, messages, method, preparedRequest, promptInput, requestBody, requestUrl, settings, systemPrompt }`. We mutate `requestUrl` to point at our backend, and replace `requestBody` with an OpenAI-shaped JSON body if not already in that shape (space-agent's chat surface targets OpenAI-compatible by default, so the shape should already match, but we re-build to be safe).

- [ ] **Step 1: Read the current hook**

```bash
cat /Users/krunal/Development/llm-wiki/customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/prepareOnscreenAgentApiRequest/end/llm-wiki.js
```

Note the existing function signature, the `hookContext.result` shape, and the structure used by Plan 1.6.

- [ ] **Step 2: Re-confirm the upstream signature against `open_router/`**

```bash
find /Users/krunal/Development/llm-wiki/vendor/space-agent -path '*open_router*' -name '*.js' -exec cat {} \;
```

Make a note of:
- The exact field name space-agent expects for the request URL (likely `requestUrl` per Plan 1.6's report, but verify)
- The body shape (likely `requestBody` containing `{ model, messages, stream }`)
- Any header massaging done by `open_router/` (auth header swap?)
- Whether the hook needs to mutate `hookContext.result` in place or return a new object

If the actual shape differs from what's documented in Plan 1.6's commit, update both the hook AND the plan's assumption — capture the corrected shape in the commit message.

- [ ] **Step 3: Rewrite the hook**

Replace the file contents with:

```javascript
// Routes the onscreen agent's chat request through the llm-wiki backend.
// When the backend is reachable, we redirect requestUrl to our
// OpenAI-compatible endpoint, replace requestBody with the messages
// array, and let space-agent's normal streaming consumer handle the
// response (it expects OpenAI chat-completions SSE format, which our
// /v1/query/openai endpoint produces).
//
// Falls through (no mutation) when the backend is not running, so
// space-agent's default provider stays in effect.

import { health } from '../../../../../../request.js';

const BACKEND_URL =
  (typeof process !== 'undefined' && process.env?.LLM_WIKI_BACKEND_URL) ||
  'http://127.0.0.1:3457';

export default async function llmWikiHook(hookContext) {
  const result = hookContext?.result;
  if (!result) return;

  // Health check: fall through if backend isn't up.
  let backendOk = false;
  try {
    await health();
    backendOk = true;
  } catch (e) {
    console.warn('[llm-wiki] backend not reachable, falling through:', e?.message ?? e);
    return;
  }

  if (!backendOk) return;

  // Redirect to our OpenAI-compatible endpoint.
  result.requestUrl = `${BACKEND_URL}/v1/query/openai`;
  result.apiEndpoint = '/v1/query/openai';

  // Build the OpenAI-shaped body. Space-agent already builds something
  // similar at this stage; we rewrite to ensure the shape matches what
  // /v1/query/openai expects regardless of upstream defaults.
  const messages = [];
  if (result.systemPrompt) {
    messages.push({ role: 'system', content: result.systemPrompt });
  }
  // The user's messages are in result.messages (already in OpenAI shape
  // per upstream's chat builder). Append them.
  if (Array.isArray(result.messages)) {
    for (const m of result.messages) {
      // Don't double-include a system message.
      if (m.role === 'system' && result.systemPrompt) continue;
      messages.push(m);
    }
  } else if (result.promptInput) {
    // Fallback when messages array isn't pre-built.
    messages.push({ role: 'user', content: String(result.promptInput) });
  }

  result.requestBody = JSON.stringify({
    model: 'llm-wiki',
    messages,
    stream: true,
  });

  // Headers: our backend doesn't require auth (localhost-only).
  // Strip any provider auth header upstream may have set.
  if (result.headers && typeof result.headers === 'object') {
    delete result.headers['Authorization'];
    delete result.headers['authorization'];
    result.headers['Content-Type'] = 'application/json';
  }

  // Annotate so downstream extensions / debug surfaces can tell.
  result.llmWiki = { intercepted: true, providerRoute: '/v1/query/openai' };
}
```

If the upstream `open_router/` inspection (Step 2) reveals a different field name or contract, adapt accordingly. The commit message should capture the actual shape.

- [ ] **Step 4: Syntax-check the JS file**

```bash
node --check /Users/krunal/Development/llm-wiki/customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/prepareOnscreenAgentApiRequest/end/llm-wiki.js
```

Expected: silent (no syntax errors).

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/prepareOnscreenAgentApiRequest/end/llm-wiki.js
git commit -m "feat(customware): chat hook actually routes to /v1/query/openai"
```

If the upstream signature inspection in Step 2 turned up a deviation from Plan 1.6's documented shape, capture it explicitly:

```bash
git commit -m "feat(customware): chat hook actually routes to /v1/query/openai

Upstream open_router uses <field> instead of <field> as documented in
Plan 1.6 — adapted accordingly."
```

---

## Task 3: End-to-end smoke test

**Files:** (none new)

This task verifies the full path manually: start backend, start space-agent, log in, send a chat message, observe the response coming through our LLM provider.

- [ ] **Step 1: Boot both processes**

In one terminal:

```bash
cd /Users/krunal/Development/llm-wiki && pnpm dev:full
```

Expected: backend logs appear (`listening on http://127.0.0.1:3457`, `profile: claude-sdk`), then space-agent logs ("listening on http://127.0.0.1:3456" or similar). Both processes stay running.

- [ ] **Step 2: Open the browser**

Navigate to http://127.0.0.1:3456. Log in as `admin / change-me-now`.

- [ ] **Step 3: Send a chat message**

Find the chat surface (default in space-agent's main view). Send: `What is 2+2?`.

Expected:
- A response streams back containing "4" or similar
- The browser DevTools Network panel shows a POST to `http://127.0.0.1:3457/v1/query/openai` (NOT to OpenAI's API or any external host)
- The browser console shows the `[llm-wiki] backend healthy:` log from the login hook (Plan 1.6 Task 8) followed by absence of fall-through warnings

- [ ] **Step 4: If the request did NOT route through our backend**

Possible causes:
- Hook didn't fire — verify the file path is correct (`prepareOnscreenAgentApiRequest/end/llm-wiki.js`)
- `result.requestUrl` is the wrong field name — open the browser DevTools Sources panel, inspect the upstream chat code, find the actual field used to construct `fetch(...)` calls. Update the hook.
- CORS — our backend may need CORS headers for the browser to talk to it from `http://127.0.0.1:3456` to `http://127.0.0.1:3457`. If so, add `import { cors } from 'hono/cors'` and `app.use('/*', cors())` in `src/backend/server.ts`. Commit as a separate task.

Document whatever you find.

- [ ] **Step 5: Stop both processes**

`Ctrl-C` in the dev:full terminal.

- [ ] **Step 6: Commit any CORS or hook-shape fixes**

If Step 4 surfaced bugs, commit fixes individually:

```bash
git commit -m "fix(backend): enable CORS for localhost:3456 → :3457"
git commit -m "fix(customware): correct requestUrl field name (was <X>)"
```

If everything Just Worked, no commit needed for this task — move on.

---

## Task 4: README — chat works in space-agent now

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the `dev:full` section**

Find the existing `## Running everything` section (added in Plan 1.6) and append:

```markdown
### Chat actually flows through llm-wiki

After Plan 1.7, the chat in space-agent's UI routes through our backend's `/v1/query/openai` endpoint, which calls whatever `LLMProvider` is configured in the active llm-wiki profile.

**Flow:**
1. Browser POSTs to `http://127.0.0.1:3456/...` (space-agent's chat endpoint)
2. Space-agent's `prepareOnscreenAgentApiRequest/end/llm-wiki.js` hook redirects the request URL to `http://127.0.0.1:3457/v1/query/openai`
3. Our backend extracts the user prompt + system message, calls `LLMProvider.query()`, and streams back as OpenAI chat-completions SSE
4. Space-agent's existing streaming consumer renders the response

To verify it's actually llm-wiki and not space-agent's default: open browser DevTools → Network → filter for `:3457`. You should see one or more POSTs to `/v1/query/openai` per chat turn.

**To bypass llm-wiki and use space-agent's default provider:** stop the backend (`pnpm dev:full` would need to be restarted with backend disabled, or set `LLM_WIKI_BACKEND_URL=http://invalid:0` so the health check fails and the hook falls through). The fall-through is intentional — if our backend is down, space-agent still functions.
```

(Use real triple-backticks in the actual README.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: chat-routing flow after Plan 1.7"
```

---

## Spec coverage check

| Spec section / amendment | Implemented in |
| --- | --- |
| §2 — query enters → routed through provider | Tasks 1, 2 (now actually wired) |
| §6 — agent-mode `AgentExecutor` (Amp) and model-mode (Claude/etc) both go through unified provider | Free — provider abstraction from Plan 1' is unchanged; the hook just calls our backend |

**Out of scope (deferred):**
- Tool calls / function calling in the chat surface
- `thinking-delta` streaming to UI
- Per-conversation provider override (one llm-wiki profile drives all chat)

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0
- [ ] Typecheck passes: `pnpm typecheck` exits 0
- [ ] `pnpm backend:check` exits 0
- [ ] Customware JS files pass `node --check`
- [ ] Manual smoke (Task 3): `pnpm dev:full` boots both processes; chat in browser at :3456 actually invokes our backend at :3457 (verifiable via DevTools Network)
- [ ] `git log --oneline` shows ~5 new commits (one per task 0–4, possibly +1 for any CORS/hook fixes from Task 3 Step 6)

---

*End of Plan 1.7.*
