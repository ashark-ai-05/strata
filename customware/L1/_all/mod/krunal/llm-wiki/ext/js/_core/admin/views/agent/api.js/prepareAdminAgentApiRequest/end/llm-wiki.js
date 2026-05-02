// Admin-chat sibling to the onscreen-agent hook. Routes admin agent
// requests through the llm-wiki backend the same way.
import llmWikiOnscreenHook from
  '/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/api.js/prepareOnscreenAgentApiRequest/end/llm-wiki.js';

export default async function llmWikiAdminRequestHook(hookContext) {
  return llmWikiOnscreenHook(hookContext);
}
