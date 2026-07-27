import { describe, it, expect } from 'vitest';
import { fullscreenTriangleGeometry } from './fullscreen-pass';

describe('fullscreenTriangleGeometry', () => {
  it('is indexed — without an index or a position attribute the renderer resolves draw count to 0', () => {
    const geometry = fullscreenTriangleGeometry();
    expect(geometry.attributes.position).toBeUndefined();
    expect(geometry.index?.count).toBe(3);
  });

  it('covers the clip cube from one triangle', () => {
    const verts = fullscreenTriangleGeometry().attributes.aPosition.array;
    expect(Array.from(verts)).toEqual([-1, -1, 3, -1, -1, 3]);
  });
});
