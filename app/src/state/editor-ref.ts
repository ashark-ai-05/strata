import type { Editor } from 'tldraw';

let current: Editor | null = null;

export function setEditor(e: Editor | null): void {
  current = e;
}

export function getEditor(): Editor | null {
  return current;
}
