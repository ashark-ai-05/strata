import { Hono } from 'hono';
import { BackendState } from './state.js';
import { healthRoute } from './routes/health.js';

/**
 * The Hono app. Tests can hit `app.request(path)` directly without
 * spinning up an HTTP listener. The standalone listener is started
 * by `start()` in the same module.
 *
 * Routes are eagerly declared, but the BackendState is lazily initialized on
 * first request. This avoids blocking module import on profile loading while
 * keeping the route structure static (required by Hono's router).
 */
export const app = new Hono();

let statePromise: Promise<BackendState> | null = null;

export function getState(): Promise<BackendState> {
  if (!statePromise) statePromise = BackendState.create();
  return statePromise;
}

// Health
app.get('/v1/health', async (c) => {
  const state = await getState();
  return c.json({
    ok: true,
    profile: state.profileName,
    llm: state.getLLMProvider().id,
    embedder: state.getEmbedder().id,
  });
});

export async function start(port: number): Promise<void> {
  const { serve } = await import('@hono/node-server');
  const s = await getState();
  serve({ fetch: app.fetch, port });
  console.log(`[llm-wiki backend] listening on http://127.0.0.1:${port}`);
  console.log(`[llm-wiki backend] profile: ${s.profileName}`);
  console.log(`[llm-wiki backend] llm:     ${s.getLLMProvider().id}`);
  console.log(`[llm-wiki backend] embed:   ${s.getEmbedder().id}`);
}
