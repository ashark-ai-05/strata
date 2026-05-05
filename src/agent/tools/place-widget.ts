import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { WIDGET_KINDS, ROLES } from '../types.js';
import { validatePayloadForKind } from '../payloads.js';
import type { WithArgs } from './_shared.js';

const inputShape = {
  kind: z.enum(WIDGET_KINDS).describe('widget kind (one of the 12 registered kinds)'),
  role: z.enum(ROLES).describe('logical placement role'),
  payload: z
    .record(z.string(), z.unknown())
    .describe('content payload (schema depends on kind)'),
};

type Args = {
  kind: (typeof WIDGET_KINDS)[number];
  role: (typeof ROLES)[number];
  payload: Record<string, unknown>;
};

type PlaceWidgetToolDef = WithArgs<typeof inputShape, Args>;

export function placeWidgetTool(): PlaceWidgetToolDef {
  const def = tool(
    'place_widget',
    `Place a widget on the canvas at the role's slot in the active template.

Every payload accepts optional \`source\` (single canonical origin) AND \`sources\` (array of {url, label?} for multi-attribution).

Payload schema per kind (use these field names exactly):
  - markdown        { title, body }
  - code-block      { title, language, code }
  - ticket          { ticketId, title, status, assignee?, priority?, description? }
  - web-embed       { title, url, snippet? }
  - key-value-card  { title, fields: [{ key, value, url? }] }
  - table           { title, columns: [{ key, label?, align?: left|right|center, mono?: bool }], rows: string[][], rowLinks?: (url|null)[] }
  - timeline        { title, events: [{ timestamp, label, body?, kind?, url? }] }
  - file-tree       { title, root: { name, type: file|directory, children?, meta?, url? } }
  - tasks           { title, items: [{ id?, text, done?, assignee?, due?, priority?, url? }] }
  - kanban          { title, columns: [{ id?, name, colour?: neutral|blue|amber|green|rose|violet, cards: [{ id?, title, body?, assignee?, priority?, tag?, url? }] }] }
  - sticky-note     { body, author?, colour?: yellow|pink|blue|green|violet|orange }
  - composite       { title, sections: [{ heading?, kind: <any non-composite kind>, payload }] } — ONE card with multiple typed sections; cannot nest composite`,
    inputShape,
    async (args) => {
      try {
        const validated = validatePayloadForKind(args.kind, args.payload);
        const id = randomUUID();
        const directive = {
          type: 'place' as const,
          id,
          kind: args.kind,
          role: args.role,
          payload: validated,
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, id, directive }) },
          ],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: 'text' as const, text: `Invalid payload for kind=${args.kind}: ${message}` },
          ],
          isError: true,
        };
      }
    },
  );
  return def as unknown as PlaceWidgetToolDef;
}
