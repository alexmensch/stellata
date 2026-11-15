import { describe, expect, it } from 'vitest';
import { ARCSEC_TO_RAD } from '../../../../src/astro-core/astronomy-constants';
import { multiplesRow } from '../multiples-fixture';
import { parseStage6Offset } from './anchor-offset-pure';
import { resolveEscapePosition, resolvePosition } from './placement';

const ANCHOR = { x: 0, y: 0, z: 100 };
// At RA 0, Dec 0 the tangent plane's north is +z and its east +y.
const ON_EQUATOR = { x: 100, y: 0, z: 0 };

describe('resolvePosition', () => {
  it('takes an own per-component fit, else projects off the anchor record', () => {
    const primary = multiplesRow({ comp: 'A', orbitRole: 'primary', gaiaSourceId: '1' });
    const ownFit = multiplesRow({ gaiaSourceId: '2', x_pc: 1, y_pc: 2, z_pc: 3, distPc: 3.74 });
    expect(resolvePosition(ownFit, primary, ANCHOR)).toEqual({ x: 1, y: 2, z: 3, distPc: 3.74 });
    const north = resolvePosition(multiplesRow({ sepArcsec: 10, paDeg: 0 }), primary, ON_EQUATOR);
    const east = resolvePosition(multiplesRow({ sepArcsec: 10, paDeg: 90 }), primary, ON_EQUATOR);
    const offsetPc = 10 * ARCSEC_TO_RAD * 100;
    expect(north).toMatchObject({ x: 100, y: 0 });
    expect(north).toHaveProperty('z', expect.closeTo(offsetPc, 12));
    expect(east).toHaveProperty('y', expect.closeTo(offsetPc, 12));
    expect(east).toHaveProperty('z', expect.closeTo(0, 12));
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
    const placed = resolveEscapePosition(reached, anchorRow, ON_EQUATOR);
    const pa = 114 * Math.PI / 180;
    expect(placed).toHaveProperty('y', expect.closeTo(3.5 * Math.sin(pa) * ARCSEC_TO_RAD * 100, 12));
    expect(placed).toHaveProperty('z', expect.closeTo(3.5 * Math.cos(pa) * ARCSEC_TO_RAD * 100, 12));
    expect(resolveEscapePosition(multiplesRow({ comp: 'B', orbitRole: 'primary', anchorComp: 'A' }), anchorRow, ANCHOR)).toBeNull();
  });
});
