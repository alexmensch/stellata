import { describe, expect, it } from 'vitest';

import { J2000_JD } from '../../astro-core/astronomy-constants';
import {
  HEADER_SIZE, MAGIC, NO_PARENT, RECORD_LAYOUT, RECORD_SIZE, VERSION, encodeBinaries,
  hasRenderableOrbit, type BinaryRecord,
} from './binaries-format';

const RECORD: BinaryRecord = {
  primaryIdx: 7, secondaryIdx: 9, flags: 0, parentRelation: NO_PARENT,
  pDays: null, tJd: null, e: null, aAU: null, iRad: null, omegaRad: null, OmegaRad: null, q: null,
  sepArcsec: null, paDeg: null, sepPaEpochJd: null,
};

describe('encodeBinaries', () => {
  it('writes the header: magic, version, count', () => {
    const bytes = encodeBinaries([RECORD]);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe(MAGIC);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(VERSION);
    expect(view.getUint32(8, true)).toBe(1);
    expect(bytes.length).toBe(HEADER_SIZE + RECORD_SIZE);
  });

  it('writes an absent element as NaN and the epoch as its offset from J2000', () => {
    const view = new DataView(encodeBinaries([{ ...RECORD, sepPaEpochJd: 2459945.75 }]).buffer);
    expect(view.getFloat32(HEADER_SIZE + RECORD_LAYOUT.e, true)).toBeNaN();
    expect(view.getFloat32(HEADER_SIZE + RECORD_LAYOUT.sep_pa_epoch_jd, true)).toBe(2459945.75 - J2000_JD);
  });
});

const ELEMENTS = { pDays: 100, tJd: 2451545, e: 0.3, aAU: 5, omegaRad: 1, q: 0.4 };

describe('hasRenderableOrbit', () => {
  it('true only when P, T, e, a, ω, q are all present', () => {
    expect(hasRenderableOrbit(ELEMENTS)).toBe(true);
    for (const key of Object.keys(ELEMENTS)) {
      expect(hasRenderableOrbit({ ...ELEMENTS, [key]: null })).toBe(false);
    }
  });

  it('i is optional (Tier-2 galactic-plane fallback)', () => {
    expect(hasRenderableOrbit({ ...ELEMENTS, iRad: null })).toBe(true);
  });
});
