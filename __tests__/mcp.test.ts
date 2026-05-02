import { describe, it, expect } from 'vitest';
import type { Source, SourceTool, ResultKind } from '../src/core/source.js';
import { MCPSource } from '../src/mcp/source.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

class FakeClient {
  // Just enough surface for MCPSource to call.
  async listTools() {
    return {
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ],
    };
  }
  async callTool(args: { name: string; arguments?: unknown }) {
    return { content: [{ type: 'text' as const, text: `called ${args.name}` }] };
  }
  async close() {}
}

describe('core/source types', () => {
  it('exports a Source type with the expected shape', () => {
    // Compile-time check via type assertion. If the type's missing fields
    // or has wrong types, this won't compile.
    const s: Source = {
      id: 'test',
      name: 'Test Source',
      health: 'connected',
      tools: [],
    };
    expect(s.id).toBe('test');
  });

  it('SourceTool carries name, description, inputSchema', () => {
    const t: SourceTool = {
      name: 'read_file',
      description: 'Read file contents',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    };
    expect(t.name).toBe('read_file');
  });

  it('ResultKind union accepts all 15 kinds', () => {
    const kinds: ResultKind[] = [
      'text-document',
      'wiki-page',
      'code-file',
      'code-symbol',
      'code-diff',
      'ticket',
      'log-stream',
      'k8s-resource',
      'web-page',
      'image',
      'table-row-set',
      'metric-series',
      'chat-message',
      'runbook',
      'dashboard-embed',
    ];
    expect(kinds).toHaveLength(15);
  });
});

describe('MCPSource', () => {
  it('introspects tools via listTools()', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    const result = await source.introspect();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('read_file');
    expect(source.health).toBe('connected');
  });

  it('callTool delegates to the underlying client', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    const out = await source.callTool('read_file', { path: '/etc/hostname' });
    expect(out).toBeDefined();
  });

  it('marks source disconnected after close()', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    await source.close();
    expect(source.health).toBe('disconnected');
  });
});
