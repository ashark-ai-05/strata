import { z } from 'zod';
import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';

interface FetchByIdServiceLike {
  fetchById(id: string): Promise<{
    id: string;
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    source: string;
  } | null>;
}

/** Narrow result type: this tool always returns text content. */
interface TextOnlyCallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const inputShape = {
  id: z.string().describe('search result id from search_kb'),
};

type FetchResultToolDef = Omit<SdkMcpToolDefinition<typeof inputShape>, 'handler'> & {
  handler: (args: { id: string }, extra: unknown) => Promise<TextOnlyCallToolResult>;
};

export function fetchResultTool(service: FetchByIdServiceLike): FetchResultToolDef {
  const def = tool(
    'fetch_result',
    'Fetch the full payload of a search result by id.',
    inputShape,
    async (args) => {
      const result = await service.fetchById(args.id);
      if (!result) {
        return {
          content: [
            { type: 'text' as const, text: `result not found for id: ${args.id}` },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ result }) }],
      };
    },
  );
  return def as unknown as FetchResultToolDef;
}
