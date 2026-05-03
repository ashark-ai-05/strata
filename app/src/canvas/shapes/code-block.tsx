import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { CardFrame, CardHeader, CardTitle, Tag } from './shared';

export type CodeBlockShape = TLBaseShape<
  'strata:code-block',
  {
    w: number;
    h: number;
    language?: string;
    symbolName?: string;
    filePath?: string;
    body: string;
    uri?: string;
  }
>;

export class CodeBlockShapeUtil extends ShapeUtil<CodeBlockShape> {
  static override type = 'strata:code-block' as const;

  static override props: RecordProps<CodeBlockShape> = {
    w: T.number,
    h: T.number,
    language: T.optional(T.string),
    symbolName: T.optional(T.string),
    filePath: T.optional(T.string),
    body: T.string,
    uri: T.optional(T.string),
  };

  override getDefaultProps(): CodeBlockShape['props'] {
    return { w: 480, h: 280, body: '' };
  }

  override getGeometry(shape: CodeBlockShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: CodeBlockShape) {
    const titleParts: string[] = [];
    if (shape.props.symbolName) titleParts.push(shape.props.symbolName);
    if (shape.props.filePath) titleParts.push(shape.props.filePath);
    const title = titleParts.join(' · ') || 'Code';

    return (
      <HTMLContainer>
        <CardFrame shape={shape}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {shape.props.language && <Tag>{shape.props.language}</Tag>}
          </CardHeader>
          <pre className="strata-card-body strata-card-body--mono" style={{ margin: 0 }}>
            {shape.props.body}
          </pre>
        </CardFrame>
      </HTMLContainer>
    );
  }

  override indicator(shape: CodeBlockShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={12} />;
  }

  override canResize() {
    return true;
  }
}
