// Routes the onscreen agent's chat request through the llm-wiki backend.
// When the backend is reachable, we redirect requestUrl to our
// OpenAI-compatible endpoint, replace requestBody with the messages
// array, and let space-agent's normal streaming consumer handle the
// response (it expects OpenAI chat-completions SSE format, which our
// /v1/query/openai endpoint produces).
//
// Falls through (no mutation) when the backend is not running, so
// space-agent's default provider stays in effect.
//
// === Upstream hook contract (verified against vendor/space-agent api.js) ===
//
// hookContext.result = {
//   apiEndpoint: string,          // LLM API endpoint URL
//   headers: Record<string,string>, // auth headers (Content-Type + Authorization)
//   messages: Message[],          // chat messages array (already built by upstream)
//   method: 'POST',
//   preparedRequest: object,      // upstream PreparedRequest
//   promptInput: object|null,     // prompt input metadata
//   requestBody: object,          // full OpenAI-format request body (NOT a string —
//                                 // buildFetchRequestInit calls JSON.stringify on it)
//   requestUrl: string,           // actual URL to POST to (used by fetch())
//   settings: object,             // agent settings (model, apiKey, apiEndpoint, etc)
//   systemPrompt: string,         // system prompt
// }
//
// The hook assigns a new object to hookContext.result (open_router pattern).
// requestBody must remain a plain object; space-agent's buildFetchRequestInit
// will JSON.stringify it before sending.

import { health, getBackendUrl } from '../../../../../request.js';

export default async function llmWikiOnscreenRequestHook(hookContext) {
  const apiRequest = hookContext?.result;

  if (!apiRequest || typeof apiRequest !== 'object') {
    return;
  }

  // Health check: fall through if backend isn't up.
  let backendUrl;
  try {
    await health();
    backendUrl = getBackendUrl();
  } catch (e) {
    console.warn('[llm-wiki] backend not reachable, falling through:', e?.message ?? e);
    return;
  }

  // Redirect to our OpenAI-compatible endpoint.
  const targetUrl = `${backendUrl}/v1/query/openai`;

  // Build the OpenAI-shaped body. requestBody must be a plain object —
  // buildFetchRequestInit in space-agent calls JSON.stringify on it.
  const messages = [];
  if (apiRequest.systemPrompt) {
    messages.push({ role: 'system', content: apiRequest.systemPrompt });
  }
  // apiRequest.messages is already in OpenAI shape per upstream's chat builder.
  if (Array.isArray(apiRequest.messages)) {
    for (const m of apiRequest.messages) {
      // Don't double-include a system message we already added above.
      if (m.role === 'system' && apiRequest.systemPrompt) continue;
      messages.push(m);
    }
  } else if (apiRequest.promptInput) {
    // Fallback when messages array isn't pre-built.
    messages.push({ role: 'user', content: String(apiRequest.promptInput) });
  }

  // Headers: our backend doesn't require auth (localhost-only).
  // Strip any provider auth header upstream may have set.
  const headers =
    apiRequest.headers && typeof apiRequest.headers === 'object'
      ? { ...apiRequest.headers }
      : {};
  delete headers['Authorization'];
  delete headers['authorization'];
  headers['Content-Type'] = 'application/json';

  hookContext.result = {
    ...apiRequest,
    requestUrl: targetUrl,
    apiEndpoint: '/v1/query/openai',
    headers,
    requestBody: {
      model: 'llm-wiki',
      messages,
      stream: true,
    },
    // Annotate so downstream extensions / debug surfaces can tell.
    llmWiki: { intercepted: true, version: '1.7', providerRoute: '/v1/query/openai' },
  };
}
