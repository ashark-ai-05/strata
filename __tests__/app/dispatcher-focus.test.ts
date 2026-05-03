import { describe, it, expect, vi } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher';

describe('applyToolDirective — focus', () => {
  it('zooms the editor to the bounds of the shape with the matching id', () => {
    const zoomToBounds = vi.fn();
    const editor = {
      getShape: vi.fn().mockReturnValue({
        id: 'shape:w-1',
        x: 100,
        y: 200,
        props: { w: 320, h: 200 },
      }),
      zoomToBounds,
    } as never;
    applyToolDirective(editor, { type: 'focus', id: 'w-1' }, 'ask-anything');
    expect(zoomToBounds).toHaveBeenCalledTimes(1);
    const [bounds] = (zoomToBounds as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(bounds).toEqual({ x: 100, y: 200, w: 320, h: 200 });
  });

  it('looks up the shape under the prefixed id "shape:<directive.id>"', () => {
    const getShape = vi.fn().mockReturnValue({ x: 0, y: 0, props: { w: 320, h: 200 } });
    const editor = { getShape, zoomToBounds: vi.fn() } as never;
    applyToolDirective(editor, { type: 'focus', id: 'w-42' }, 'ask-anything');
    expect(getShape).toHaveBeenCalledWith('shape:w-42');
  });

  it('throws when the shape is not found', () => {
    const editor = { getShape: () => undefined, zoomToBounds: vi.fn() } as never;
    expect(() =>
      applyToolDirective(editor, { type: 'focus', id: 'missing' }, 'ask-anything'),
    ).toThrow(/not found/);
  });
});
