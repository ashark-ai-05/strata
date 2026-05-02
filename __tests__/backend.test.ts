import { describe, it, expect } from 'vitest';
import { BackendState } from '../src/backend/state.js';
import { app } from '../src/backend/server.js';

describe('BackendState', () => {
  it('lazily creates the LLM provider for the active profile', async () => {
    const state = await BackendState.create();
    const provider = state.getLLMProvider();
    expect(provider.kind).toBeDefined();
    expect(provider.id).toBeDefined();
  });

  it('lazily creates the embedder for the active profile', async () => {
    const state = await BackendState.create();
    const embedder = state.getEmbedder();
    expect(embedder.dims).toBeGreaterThan(0);
    expect(embedder.id).toBeDefined();
  });

  it('returns the profile name', async () => {
    const state = await BackendState.create();
    expect(typeof state.profileName).toBe('string');
    expect(state.profileName.length).toBeGreaterThan(0);
  });

  it('source registry starts empty until ensureSourcesConnected is awaited', async () => {
    const state = await BackendState.create();
    expect(state.getSourceRegistry().list()).toEqual([]);
  });
});

describe('GET /v1/health', () => {
  it('returns ok with profile metadata', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; profile: string };
    expect(json.ok).toBe(true);
    expect(typeof json.profile).toBe('string');
  });
});
