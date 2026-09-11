import { describe, expect, it } from 'vitest';
import { DEPTH_MASK_RENDER_ORDER } from './render-order';

describe('shared draw-order slots', () => {
  // The earliest background layer sits at -3 (../README.md § Full render
  // stack), so a depth stamp that moved to -3 or later would stop culling
  // the layers it exists to cull, silently and without a visual change.
  it('puts the depth-only slot ahead of every background layer', () => {
    expect(DEPTH_MASK_RENDER_ORDER).toBe(-4);
  });
});
