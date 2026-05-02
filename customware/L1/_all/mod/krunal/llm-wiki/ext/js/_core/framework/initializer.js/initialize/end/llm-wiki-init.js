// Fires after framework page initialization. Pre-warms the embedder via
// the llm-wiki backend so the first user query doesn't pay the ONNX cold-
// start (~4.5s on M-series CPU). Best effort; failures are logged but
// do not block init.
//
// Per design spec amendment 3: pre-warm on app launch is mandatory.
//
// Hook seam: _core/framework/initializer.js/initialize/end (per the
// extensions skill — framework-backed pages expose this seam after
// once-per-page shell setup).

import { health, embed } from '/mod/krunal/llm-wiki/ext/request.js';

export default async function llmWikiInit() {
  // health() fast-exits if backend isn't running; embed warmup is fire-and-forget.
  try {
    const h = await health();
    console.info('[llm-wiki] backend healthy:', h);
  } catch (e) {
    console.warn('[llm-wiki] backend health check failed:', e?.message ?? e);
    return;
  }

  // Fire-and-forget warmup. Do not await — returns immediately so login
  // is not delayed.
  embed(['warmup']).catch((e) => {
    console.warn('[llm-wiki] embedder warmup failed:', e?.message ?? e);
  });
}
