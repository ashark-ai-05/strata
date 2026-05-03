import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { cardBody, cardFrame, cardHeader, CardTitle, tag } from './shared';

export type TicketCardShape = TLBaseShape<
  'strata:ticket',
  {
    w: number;
    h: number;
    ticketId: string;
    title: string;
    status?: string;
    assignee?: string;
    description?: string;
    uri?: string;
  }
>;

const STATUS_COLOR: Record<string, string> = {
  todo: '#71717a',
  'in-progress': '#f59e0b',
  done: '#22c55e',
  blocked: '#ef4444',
};

export class TicketCardShapeUtil extends ShapeUtil<TicketCardShape> {
  static override type = 'strata:ticket' as const;

  static override props: RecordProps<TicketCardShape> = {
    w: T.number,
    h: T.number,
    ticketId: T.string,
    title: T.string,
    status: T.optional(T.string),
    assignee: T.optional(T.string),
    description: T.optional(T.string),
    uri: T.optional(T.string),
  };

  override getDefaultProps(): TicketCardShape['props'] {
    return {
      w: 320,
      h: 200,
      ticketId: 'TICKET-?',
      title: 'Untitled ticket',
    };
  }

  override getGeometry(shape: TicketCardShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TicketCardShape) {
    const color = shape.props.status ? STATUS_COLOR[shape.props.status] ?? '#71717a' : '#71717a';
    return (
      <HTMLContainer style={{ ...cardFrame, width: shape.props.w, height: shape.props.h }}>
        <div style={cardHeader}>
          <span style={{ ...tag, fontFamily: 'ui-monospace, monospace' }}>{shape.props.ticketId}</span>
          <CardTitle>{shape.props.title}</CardTitle>
          {shape.props.status && (
            <span style={{ ...tag, background: color, color: '#0a0a0a' }}>{shape.props.status}</span>
          )}
        </div>
        <div style={cardBody}>
          {shape.props.assignee && (
            <div style={{ marginBottom: 8, color: '#a1a1aa' }}>
              <span style={{ color: '#71717a' }}>assignee: </span>
              {shape.props.assignee}
            </div>
          )}
          {shape.props.description && (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {shape.props.description}
            </div>
          )}
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: TicketCardShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} />;
  }

  override canResize() {
    return true;
  }
}
