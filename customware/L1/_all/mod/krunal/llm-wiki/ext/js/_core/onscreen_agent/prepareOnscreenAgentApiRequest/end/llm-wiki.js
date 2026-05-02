// Routes the onscreen agent's chat request through our backend so that
// space-agent's chat actually flows through the LLMProvider configured
// in ~/.llm-wiki/config.json.
//
// === Upstream hook contract (verified against vendor/space-agent) ===
//
// Extension point: _core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest/end
// Hook signature: export default async function(hookContext)
//   hookContext.result = {
//     apiEndpoint: string,       // LLM API endpoint URL
//     headers: Record<string,string>, // auth headers
//     messages: Message[],       // chat messages array
//     method: 'POST',
//     preparedRequest: object,   // upstream PreparedRequest
//     promptInput: object|null,  // prompt input metadata
//     requestBody: object,       // full OpenAI-format request body
//     requestUrl: string,        // actual URL to POST to
//     settings: object,          // agent settings (model, apiKey, etc)
//     systemPrompt: string,      // system prompt
//   }
//
// The hook mutates hookContext.result and returns void (not hookContext).
// Compare: open_router hook sets hookContext.result.headers and .requestUrl.
//
// === Integration gap (TODO — Plan 1.7) ===
//
// Our /v1/query backend streams ProviderEvent SSE (text-delta, done, error),
// NOT the OpenAI chat completions SSE format (data: {"choices":[...]}).
// space-agent's streamOnscreenAgentCompletion expects OpenAI format.
//
// To complete the integration we need one of:
//   A) A /v1/query/openai endpoint that wraps ProviderEvents in OpenAI SSE format
//      so space-agent can consume it natively (minimal change to space-agent);
//   B) A /v1/proxy endpoint that is fully OpenAI-compatible (chat/completions style)
//      and replaces the requestUrl entirely;
//   C) A second hook at streamOnscreenAgentCompletion/start that intercepts the
//      streaming call and injects our SSE reader (more invasive).
//
// For now (Plan 1.6 scaffold): we annotate hookContext.result with llm-wiki
// metadata so downstream hooks/debugging can see us, but we do NOT redirect
// the requestUrl — we fall through to the configured provider.
//
// TODO(Plan 1.7): Implement option A or B above to complete the integration.

export default async function llmWikiOnscreenRequestHook(hookContext) {
  const apiRequest = hookContext?.result;

  if (!apiRequest || typeof apiRequest !== 'object') {
    return;
  }

  // Annotate the request with llm-wiki metadata (diagnostic / future use).
  // Kept separate from apiRequest to avoid breaking upstream field expectations.
  hookContext.result = {
    ...apiRequest,
    llmWiki: {
      version: '1.6',
      backendUrl: (typeof process !== 'undefined' && process.env?.LLM_WIKI_BACKEND_URL) || 'http://127.0.0.1:3457',
      // TODO(Plan 1.7): set intercepted: true and redirect requestUrl once
      // /v1/query is wrapped in OpenAI-compatible SSE format.
      intercepted: false,
    },
  };

  // Fall through: let space-agent use its configured provider.
  // When intercepted: true, we would instead:
  //   hookContext.result.requestUrl = `${backendUrl}/v1/query/openai`;
  //   hookContext.result.apiEndpoint = `${backendUrl}/v1/query/openai`;
  //   hookContext.result.headers = {}; // backend handles auth internally
}
