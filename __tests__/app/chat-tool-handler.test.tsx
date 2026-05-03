import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Mock the dispatcher module BEFORE importing Chat (Vitest handles hoisting).
// Use vi.hoisted so mocks are available inside the hoisted vi.mock factory.
const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock('../../app/src/canvas/dispatcher', () => ({
  applyToolDirective: applyMock,
  placeResultsOnCanvas: vi.fn(),
}));

// Provide a fake editor via the singleton.
import { setEditor } from '../../app/src/state/editor-ref';

// Mock useChat to inject a controlled messages array.
const { messagesRef } = vi.hoisted(() => ({
  messagesRef: {
    current: [] as Array<{ id: string; role: string; parts: unknown[] }>,
  },
}));
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: messagesRef.current,
    sendMessage: vi.fn(),
    status: 'ready' as const,
  }),
}));

import { Chat } from '../../app/src/components/Chat';

beforeEach(() => {
  applyMock.mockClear();
  messagesRef.current = [];
  setEditor({} as never); // any non-null sentinel — applyToolDirective is mocked
  cleanup();
});

describe('Chat tool handler', () => {
  it('dispatches a place directive when output is an object with .directive', () => {
    messagesRef.current = [
      {
        id: 'm-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-available',
            toolCallId: 'tc-1',
            output: {
              ok: true,
              id: 'w-1',
              directive: {
                type: 'place',
                id: 'w-1',
                kind: 'markdown',
                role: 'primary',
                payload: { title: 't', body: 'b' },
              },
            },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]![1].type).toBe('place');
  });

  it('parses string output (real MCP tool shape) and dispatches the directive', () => {
    const directive = {
      type: 'place',
      id: 'w-2',
      kind: 'markdown',
      role: 'detail',
      payload: { title: 't', body: 'b' },
    };
    messagesRef.current = [
      {
        id: 'm-2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-available',
            toolCallId: 'tc-2',
            output: JSON.stringify({ ok: true, id: 'w-2', directive }),
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]![1]).toMatchObject(directive);
  });

  it('does not double-apply on re-render', async () => {
    messagesRef.current = [
      {
        id: 'm-3',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-available',
            toolCallId: 'tc-3',
            output: {
              directive: {
                type: 'place',
                id: 'w-3',
                kind: 'markdown',
                role: 'primary',
                payload: { title: 't', body: 'b' },
              },
            },
          },
        ],
      },
    ];
    const { rerender } = render(<Chat />);
    rerender(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it('skips parts that are not tool-output-available', () => {
    messagesRef.current = [
      {
        id: 'm-4',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'tool-input-available', toolCallId: 'tc-4', toolName: 'search_kb', input: {} },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('silently skips malformed string output (not a directive)', () => {
    messagesRef.current = [
      {
        id: 'm-5',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-available',
            toolCallId: 'tc-5',
            output: 'not json',
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('skips tool-output-available without a .directive field (e.g., search_kb result)', () => {
    messagesRef.current = [
      {
        id: 'm-6',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-available',
            toolCallId: 'tc-6',
            output: { results: [{ id: 'a', kind: 'doc', title: 't' }] },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('does not dispatch when no editor is registered', () => {
    setEditor(null);
    messagesRef.current = [
      {
        id: 'm-7',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-available',
            toolCallId: 'tc-7',
            output: {
              directive: { type: 'place', id: 'x', kind: 'markdown', role: 'primary', payload: {} },
            },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });
});

describe('Chat tool indicators', () => {
  it('renders "calling <toolName>…" for tool-input-available parts', () => {
    messagesRef.current = [
      {
        id: 'm-call',
        role: 'assistant',
        parts: [
          {
            type: 'tool-input-available',
            toolCallId: 'tc-call',
            toolName: 'search_kb',
            input: { query: 'auth' },
          },
        ],
      },
    ];
    const { getByText } = render(<Chat />);
    expect(getByText(/calling search_kb/i)).toBeDefined();
  });

  it('renders "tool error: <errorText>" for tool-output-error parts', () => {
    messagesRef.current = [
      {
        id: 'm-err',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-error',
            toolCallId: 'tc-err',
            errorText: 'Invalid payload for kind=markdown',
          },
        ],
      },
    ];
    const { getByText } = render(<Chat />);
    expect(getByText(/tool error: Invalid payload for kind=markdown/)).toBeDefined();
  });

  it('renders no visible indicator for tool-output-available (directive applied silently)', () => {
    messagesRef.current = [
      {
        id: 'm-out',
        role: 'assistant',
        parts: [
          {
            type: 'tool-output-available',
            toolCallId: 'tc-out',
            output: { directive: { type: 'place', id: 'w', kind: 'markdown', role: 'primary', payload: {} } },
          },
        ],
      },
    ];
    const { container } = render(<Chat />);
    // Message wrapper exists but no "calling" or "tool error" text
    expect(container.textContent).not.toMatch(/calling/i);
    expect(container.textContent).not.toMatch(/tool error/i);
  });

  it('still renders text parts alongside indicators', () => {
    messagesRef.current = [
      {
        id: 'm-mixed',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Looking that up.' },
          { type: 'tool-input-available', toolCallId: 'tc-x', toolName: 'fetch_result', input: { id: 'x' } },
          { type: 'text', text: ' Here it is.' },
        ],
      },
    ];
    const { getByText } = render(<Chat />);
    expect(getByText(/Looking that up\./)).toBeDefined();
    expect(getByText(/calling fetch_result/i)).toBeDefined();
    expect(getByText(/Here it is\./)).toBeDefined();
  });
});
