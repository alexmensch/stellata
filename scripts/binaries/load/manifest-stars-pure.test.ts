import { describe, expect, it } from 'vitest';

import { angularSeparationArcsec, unitVectorFromRaDec } from '../../../src/astro-core/equatorial-basis';
import { gaia5pRow } from './load-fixture';
import { hip2At } from '../resolve/resolve-fixture';
import { buildManifestIndex, type ManifestPositionSources } from './manifest-stars-pure';

const record = (over: { hip?: number | null; tyc?: string | null; gaiaSourceId?: string | null }) =>
  ({ hip: null, tyc: null, gaiaSourceId: null, ...over });

const sources = (over: Partial<ManifestPositionSources> = {}): ManifestPositionSources =>
  ({ gaiaAstrometry: new Map(), hip2: new Map(), nss: new Map(), tycho2: new Map(), ...over });

describe('buildManifestIndex', () => {
  it('maps each HIP to its derived source, and skips a HIP with none', () => {
    const idx = buildManifestIndex([record({ hip: 1, gaiaSourceId: '11' }), record({ hip: 2 })], sources());
    expect([...idx.hipToGaia]).toEqual([[1, '11']]);
  });

  it('throws on a HIP two records carry', () => {
    expect(() => buildManifestIndex([record({ hip: 1 }), record({ hip: 1 })], sources())).toThrow(/HIP 1 on two records/);
  });

  it('places a record by its Gaia row, else its HIP2 row, and leaves out one no source places', () => {
    const idx = buildManifestIndex([
      record({ gaiaSourceId: '11', hip: 1 }), record({ hip: 2 }), record({ gaiaSourceId: '33' }),
    ], sources({
      gaiaAstrometry: new Map([['11', gaia5pRow({ sourceId: '11', raDeg: 10, decDeg: 5 })]]),
      hip2: hip2At({ hip: 1, ra: 50, dec: 5 }, { hip: 2, ra: 20, dec: -5 }),
    }));
    expect(idx.stars.map((s) => [s.gaia, s.hip, Math.round(s.raDeg)])).toEqual([['11', 1, 10], [null, 2, 20]]);
  });

  it('carries a HIP2 position from J1991.25 to the WDS epoch on its proper motion', () => {
    const idx = buildManifestIndex([record({ hip: 7 })], sources({
      hip2: hip2At({ hip: 7, ra: 100, dec: 0, pmRaMasyr: 1000, pmDeMasyr: 0 }),
    }));
    expect(angularSeparationArcsec(idx.stars[0].readings[0], unitVectorFromRaDec(100, 0))).toBeCloseTo(8.75, 2);
    expect(idx.stars[0].hasPm).toBe(true);
  });

  it('marks a position whose source states no proper motion', () => {
    const idx = buildManifestIndex([record({ hip: 7 })], sources({ hip2: hip2At({ hip: 7, ra: 100, dec: 0 }) }));
    expect(idx.stars[0].hasPm).toBe(false);
  });
});
