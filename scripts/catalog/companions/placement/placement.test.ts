import { describe, expect, it } from 'vitest';
import { multiplesRow } from '../multiples-fixture';
import { parseStage6Offset } from './anchor-offset-pure';
import { resolveEscapePosition, resolvePosition } from './placement';

const ANCHOR = { x: 0, y: 0, z: 100 };

describe('resolvePosition', () => {
  it('takes an own per-component fit, else projects off the anchor record', () => {
    const primary = multiplesRow({ comp: 'A', orbitRole: 'primary', gaiaSourceId: '1' });
    const ownFit = multiplesRow({ gaiaSourceId: '2', x_pc: 1, y_pc: 2, z_pc: 3, distPc: 3.74 });
    expect(resolvePosition(ownFit, primary, ANCHOR)).toEqual({ x: 1, y: 2, z: 3, distPc: 3.74 });
    const projected = resolvePosition(multiplesRow({ sepArcsec: 10, paDeg: 0 }), primary, ANCHOR);
    expect(projected).not.toBeNull();
    expect(projected).not.toBe('beyond-tidal');
  });

  it('refuses a projection past the tidal limit, and a sub-resolution pair with no renderable orbit', () => {
    expect(resolvePosition(multiplesRow({ sepArcsec: 3600, paDeg: 0 }), null, ANCHOR)).toBe('beyond-tidal');
    expect(resolvePosition(multiplesRow({ sepArcsec: 0 }), null, ANCHOR)).toBeNull();
  });
});

describe('resolveEscapePosition', () => {
  it('projects a re-based Stage 6 offset off the root anchor, and places nothing without one', () => {
    const anchorRow = multiplesRow({ comp: 'A', orbitRole: 'primary', anchorComp: 'A' });
    const reached = multiplesRow({
      comp: 'B', orbitRole: 'primary', anchorComp: 'A', anchorOffset: parseStage6Offset('B', 'A', 3.5, 114),
    });
    const placed = resolveEscapePosition(reached, anchorRow, ANCHOR);
    expect(placed).not.toBeNull();
    expect(placed).not.toBe('beyond-tidal');
    expect(resolveEscapePosition(multiplesRow({ comp: 'B', orbitRole: 'primary', anchorComp: 'A' }), anchorRow, ANCHOR)).toBeNull();
  });
});
