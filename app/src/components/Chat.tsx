import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { applyToolDirective } from '../canvas/dispatcher';
import { getLatestSnapshot } from '../state/snapshot-ref';
import { getEditor } from '../state/editor-ref';
import { useTemplateStore } from '../state/template-store';
import type { ToolDirective } from '../../../src/agent/types';

/**
 * AI SDK 6 surfaces UIMS tool chunks as parts shaped:
 *   { type: 'tool-<toolName>' | 'dynamic-tool',
 *     state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error',
 *     toolCallId, input?, output?, errorText? }
 * — NOT as { type: 'tool-output-available' }. We narrow with helpers below
 * so the dispatch logic and indicator rendering stay readable.
 */
type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function isToolPart(p: { type: string }): p is ToolPart {
  return p.type === 'dynamic-tool' || p.type.startsWith('tool-');
}

/** Pretty-print the tool name from a part, for the "calling X…" indicator. */
function toolPartName(p: ToolPart): string {
  if (p.type === 'dynamic-tool') return p.toolName ?? 'unknown';
  // 'tool-mcp__strata__place_widget' → 'place_widget'; 'tool-foo' → 'foo'.
  const raw = p.type.slice('tool-'.length);
  const last = raw.split('__').pop();
  return last && last.length > 0 ? last : raw;
}

function parseToolOutput(
  output: unknown,
): { directive: ToolDirective } | null {
  let value: unknown = output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'directive' in value &&
    typeof (value as { directive?: unknown }).directive === 'object' &&
    (value as { directive?: unknown }).directive !== null
  ) {
    return value as { directive: ToolDirective };
  }
  return null;
}

export function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/v1/chat',
      body: () => ({ canvasSnapshot: getLatestSnapshot() }),
    }),
  });
  const [input, setInput] = useState('');
  const isStreaming = status === 'streaming';
  const appliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const editor = getEditor();
    if (!editor) return;
    for (const m of messages) {
      for (const p of m.parts as Array<{ type: string }>) {
        if (!isToolPart(p)) continue;
        const op = p as ToolPart;
        if (op.state !== 'output-available') continue;
        if (!op.toolCallId) continue;
        if (appliedRef.current.has(op.toolCallId)) continue;
        const parsed = parseToolOutput(op.output);
        if (!parsed?.directive) {
          appliedRef.current.add(op.toolCallId);
          continue;
        }
        const tplId = useTemplateStore.getState().activeTemplateId;
        try {
          applyToolDirective(editor, parsed.directive, tplId);
        } catch (e) {
          console.error('[chat] applyToolDirective failed:', e);
        }
        appliedRef.current.add(op.toolCallId);
      }
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-500 mt-12">
            <p className="text-lg">strata</p>
            <p className="text-sm">Type a message to start.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              {m.role}
            </div>
            <div className="whitespace-pre-wrap text-zinc-100">
              {(m.parts as Array<{ type: string }>).map((p, i) => {
                if (p.type === 'text') {
                  return <span key={i}>{(p as unknown as { text: string }).text}</span>;
                }
                if (isToolPart(p)) {
                  const tp = p as ToolPart;
                  if (tp.state === 'input-available' || tp.state === 'input-streaming') {
                    return (
                      <span key={i} className="block text-xs text-zinc-500 italic">
                        calling {toolPartName(tp)}…
                      </span>
                    );
                  }
                  if (tp.state === 'output-error') {
                    return (
                      <span key={i} className="block text-xs text-red-400">
                        tool error ({toolPartName(tp)}): {tp.errorText ?? 'unknown'}
                      </span>
                    );
                  }
                  // state === 'output-available': directive already applied in
                  // the useEffect; render nothing here.
                  return null;
                }
                return null;
              })}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-800 p-4 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything…"
          disabled={isStreaming}
          className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-50 disabled:hover:bg-zinc-800 transition-colors"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
