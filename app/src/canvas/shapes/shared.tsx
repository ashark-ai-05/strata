import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';

/**
 * Visual primitives for tldraw shapes. The actual styling lives in
 * `app/src/styles/globals.css` (.strata-card, .strata-card-header, etc.) so
 * the look-and-feel is changed in one place across all 5 widget kinds.
 *
 * Shapes pass `role` so the card picks up the right left-edge accent color
 * (primary=violet, detail=blue, related=teal, reference=amber, timeline=rose,
 *  node=emerald). Role lives in `shape.meta.role` (set by the dispatcher's
 *  place handler — see Plan 5 T28).
 */

type Role = 'primary' | 'detail' | 'related' | 'reference' | 'timeline' | 'node';

function readRole(meta: unknown): Role {
  if (typeof meta === 'object' && meta !== null && 'role' in meta) {
    const r = (meta as { role?: unknown }).role;
    if (
      r === 'primary' ||
      r === 'detail' ||
      r === 'related' ||
      r === 'reference' ||
      r === 'timeline' ||
      r === 'node'
    ) {
      return r;
    }
  }
  return 'primary';
}

/**
 * Outer card frame. Pass the shape so we can read role from meta and keep
 * the call sites of each ShapeUtil tidy.
 */
export function CardFrame({
  shape,
  children,
}: {
  shape: { props: { w: number; h: number }; meta?: unknown };
  children: ReactNode;
}) {
  const role = readRole(shape.meta);

  // "Freshly placed" pulse — runs once on mount, then we drop the attribute
  // so a re-render (e.g. resize) doesn't re-trigger the animation.
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setFresh(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const style: CSSProperties = { width: shape.props.w, height: shape.props.h };
  return (
    <div className="strata-card" data-role={role} data-fresh={fresh ? 'true' : 'false'} style={style}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <div className="strata-card-header">{children}</div>;
}

export function CardBody({
  mono,
  children,
}: {
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={mono ? 'strata-card-body strata-card-body--mono' : 'strata-card-body'}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <span className="strata-card-title">{children}</span>;
}

export function Tag({
  children,
  accent = false,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span className={accent ? 'strata-tag strata-tag--accent' : 'strata-tag'}>{children}</span>
  );
}
