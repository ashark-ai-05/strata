import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { T } from 'tldraw';

export type TextNoteShape = TLBaseShape<
  'llm-wiki:text-note',
  {
    w: number;
    h: number;
    text: string;
  }
>;

export class TextNoteShapeUtil extends ShapeUtil<TextNoteShape> {
  static override type = 'llm-wiki:text-note' as const;

  static override props: RecordProps<TextNoteShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
  };

  override getDefaultProps(): TextNoteShape['props'] {
    return { w: 240, h: 120, text: 'Text note' };
  }

  override getGeometry(shape: TextNoteShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TextNoteShape) {
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          padding: 12,
          background: '#18181b',
          color: '#fafafa',
          border: '1px solid #3f3f46',
          borderRadius: 6,
          fontSize: 14,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          overflow: 'hidden',
          pointerEvents: 'all',
        }}
      >
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {shape.props.text}
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: TextNoteShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }

  override canResize() {
    return true;
  }
}
