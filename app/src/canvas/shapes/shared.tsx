import type { CSSProperties, ReactNode } from 'react';

export const cardFrame: CSSProperties = {
  background: '#18181b',
  color: '#fafafa',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 13,
  pointerEvents: 'all',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

export const cardHeader: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #27272a',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

export const cardBody: CSSProperties = {
  padding: '10px 12px',
  flex: 1,
  overflow: 'auto',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
};

export const monoBody: CSSProperties = {
  ...cardBody,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  background: '#0a0a0a',
};

export const tag: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 4,
  background: '#27272a',
  color: '#a1a1aa',
};

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontWeight: 600, color: '#fafafa', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}
