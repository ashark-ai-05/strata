/**
 * Shared types for the agent-loop tool surface.
 *
 * Imported by backend tool handlers AND by the browser dispatcher
 * (via path alias) so the directive contract has one source of truth.
 *
 * Spec: REPLICATION-PROMPT.md §12.
 */

export const WIDGET_KINDS = [
  'markdown',
  'code-block',
  'ticket',
  'web-embed',
  'key-value-card',
  'table',
  'timeline',
  'file-tree',
  'composite',
  'tasks',
  'kanban',
  'sticky-note',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/**
 * Kinds that are valid as a section's `kind` inside a `composite` widget.
 * Composite cannot nest composite.
 */
export const COMPOSITE_SECTION_KINDS = WIDGET_KINDS.filter(
  (k): k is Exclude<WidgetKind, 'composite'> => k !== 'composite',
);

/**
 * Logical placement role chosen by the model when calling place_widget.
 * Each canvas template translates a role to pixel coordinates via
 * `slotForRole` (see app/src/canvas/templates). `node` is the fallback
 * for graph-shaped templates; `timeline` is the time-anchored slot.
 */
export const ROLES = [
  'primary',
  'detail',
  'related',
  'reference',
  'timeline',
  'node',
] as const;
export type Role = (typeof ROLES)[number];

export const TEMPLATE_IDS = [
  'ask-anything',
  'tell-me-about-x',
  'whats-new-since-y',
  'trace-x-everywhere',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/**
 * Backend tool handlers return one of these directives in their tool result.
 * The browser receives them via UIMS `tool-output-available` chunks and
 * applies them to tldraw via `applyToolDirective`.
 *
 * `place`/`update`/`focus` ids reference canvas widget ids (server-minted
 * UUIDs from prior place calls). `link`'s `linkId` is its own id; `from`/
 * `to` are widget ids. `switchTemplate.id` is a TemplateId enum value.
 */
export type ToolDirective =
  | {
      type: 'place';
      id: string;
      kind: WidgetKind;
      role: Role;
      payload: Record<string, unknown>;
    }
  | {
      type: 'update';
      id: string;
      payload?: Record<string, unknown>;
      appendSections?: Array<{
        heading?: string;
        kind: Exclude<WidgetKind, 'composite'>;
        payload: Record<string, unknown>;
      }>;
    }
  | {
      type: 'link';
      linkId: string;
      fromId: string;
      toId: string;
      label?: string;
    }
  | { type: 'focus'; id: string }
  | { type: 'clear' }
  | { type: 'switchTemplate'; id: TemplateId };
