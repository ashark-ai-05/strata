/**
 * Provider factory — creates the right LLMProvider instance from a Profile.
 */
import type { LLMProvider } from '../core/provider.js';
import type { Profile } from '../config/schema.js';

import { ClaudeAgentSdkAdapter } from './claude-agent-sdk.js';
import { AnthropicDirectAdapter } from './anthropic-direct.js';
import { OpenAIAdapter } from './openai.js';
import { OpenRouterAdapter } from './openrouter.js';
import { OllamaAdapter } from './ollama.js';
import { AmpAdapter } from './amp.js';

export function createProvider(profile: Profile): LLMProvider {
  const { llm } = profile;

  switch (llm.provider) {
    case 'claude-agent-sdk':
      return new ClaudeAgentSdkAdapter({ model: llm.model });

    case 'anthropic-direct':
      return new AnthropicDirectAdapter({ model: llm.model });

    case 'openai':
      return new OpenAIAdapter({ model: llm.model });

    case 'openrouter':
      return new OpenRouterAdapter({ model: llm.model, baseUrl: llm.baseUrl });

    case 'ollama':
      return new OllamaAdapter({ model: llm.model, baseUrl: llm.baseUrl });

    case 'amp':
      return new AmpAdapter();

    default: {
      // Exhaustiveness check
      const _exhaustive: never = llm;
      throw new Error(`Unknown provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export {
  ClaudeAgentSdkAdapter,
  AnthropicDirectAdapter,
  OpenAIAdapter,
  OpenRouterAdapter,
  OllamaAdapter,
  AmpAdapter,
};
