import { describe, expect, it } from 'vitest';

import { skyPositionAtEpoch } from '../../../../src/astro-core/equatorial-basis';
import type { V70aAstrometry } from '../../gliese-parse-pure';
import { TYCHO2_ICRS_EPOCH, TYCHO2_MEAN_EPOCH, type ObservedPosition } from '../../tycho2-parse';
import { tycho2Row } from '../../tycho2-fixture';
import { HIPPARCOS_EPOCH_JYEAR } from '../../../../src/astro-core/astronomy-constants';
import {
  HIPPARCOS_FORWARD_TOLERANCE_ARCSEC, HIPPARCOS_WITNESS_TOLERANCE_ARCSEC, V70A_WITNESS_TOLERANCE_ARCSEC, hipsNear, type NearHip,
  hipparcosNamesSource, hipparcosSeparationFromSource, witnessHipparcos, witnessV70a, type WitnessVerdict,
} from './positional-witness-pure';

const v70a = (raB1950Deg: number, decB1950Deg: number, pmArcsecYr: number, pmPaDeg: number): V70aAstrometry =>
  ({ raB1950Deg, decB1950Deg, pmArcsecYr, pmPaDeg });

/** A mean-solution entry placed at a Gaia DR3 source's J2000 position. */
function atGaiaSource(tyc: string, raDeg: number, decDeg: number, pmRaMasyr: number, pmDecMasyr: number) {
  const atJ2000 = skyPositionAtEpoch({ raDeg, decDeg }, { pmRaMasyr, pmDecMasyr }, 2016, TYCHO2_MEAN_EPOCH);
  return tycho2Row(tyc, atJ2000);
}

const seps = (v: WitnessVerdict) => v.separations.map((s) => [s.tyc, Number(s.separationArcsec.toFixed(1))]);

describe('witnessV70a — the v70a_astrometry dispositions, against their Gaia sources', () => {
  it('matches Gl 852.1 to the source its disposition keeps, 0.7″ off', () => {
    const v = witnessV70a(
      v70a(333.721, 15.11, 0.226, 105.0),
      [atGaiaSource('gaia', 334.332478354, 15.359376989, 208.0508, -64.0310)],
    );
    expect(v.kind).toBe('match');
    expect(seps(v)).toEqual([['gaia', 0.7]]);
  });

  it('matches Gl 167.2 at 12.1″, the widest known match, inside the tolerance', () => {
    const v = witnessV70a(
      v70a(63.762, -26.177, 0.7, 58.6),
      [atGaiaSource('gaia', 64.290815626, -26.045320542, 607.9134, 349.7335)],
    );
    expect(v.kind).toBe('match');
    expect(seps(v)).toEqual([['gaia', 12.1]]);
    expect(12.1).toBeLessThan(V70A_WITNESS_TOLERANCE_ARCSEC);
  });

  it("finds none for Gl 629.3, whose V/70A position is a coordinate slip 99.9″ off", () => {
    const v = witnessV70a(
      v70a(248.137, -49.187, 0.599, 184.8),
      [atGaiaSource('gaia', 249.114517494, -49.312468180, -46.8117, -580.1031)],
    );
    expect(v.kind).toBe('none');
    expect(seps(v)).toEqual([['gaia', 99.9]]);
  });
});

describe('witnessV70a — against Tycho-2 entries', () => {
  // The spine puts Gl 369 on TYC 5483-335-1; V/70A's own place is 410″ from
  // it and 0.7″ from its neighbour, Tycho-2's 1.1″/yr star.
  it('names the entry the position lands on, not the one the cell sits on', () => {
    const v = witnessV70a(v70a(147.167, -12.075, 1.791, 143.4), [
      tycho2Row('5483-335-1', { raDeg: 147.67627427, decDeg: -12.3055527 }),
      tycho2Row('5483-418-1', { raDeg: 147.79017241, decDeg: -12.32987517 }),
    ]);
    expect(v).toMatchObject({ kind: 'match', tyc: '5483-418-1' });
    expect(seps(v)).toEqual([['5483-418-1', 0.7], ['5483-335-1', 410.4]]);
  });

  it('returns several when a close pair both fall inside the tolerance', () => {
    const supplement = (tyc: string, raDeg: number, decDeg: number) =>
      tycho2Row(tyc, { raDeg, decDeg, epoch: TYCHO2_ICRS_EPOCH, fromIcrs: true });
    const v = witnessV70a(v70a(168.208, -17.862, 0.754, 169.3), [
      supplement('6087-1752-1', 168.83081702, -18.14405623),
      supplement('6087-1753-1', 168.83622206, -18.1433214),
    ]);
    expect(v).toMatchObject({ kind: 'several', tycs: ['6087-1752-1', '6087-1753-1'] });
    expect(seps(v)).toEqual([['6087-1752-1', 5.4], ['6087-1753-1', 13.8]]);
  });

  it("reads a photocentre entry's observed cell, not the blend's mean position", () => {
    const photocentre = tycho2Row('1024-2212-2', {
      raDeg: 279.50029734, decDeg: 8.00067305, isPhotocentre: true,
      observed: { raDeg: 279.50013611, decDeg: 8.00051333, raEpoch: 1991.83, decEpoch: 1991.75 },
    });
    const atObserved = witnessV70a(v70a(279.0, 7.9, 0, 0), [photocentre]);
    const atMean = witnessV70a(v70a(279.0, 7.9, 0, 0), [
      tycho2Row('1024-2212-2', { raDeg: 279.50029734, decDeg: 8.00067305 }),
    ]);
    expect(seps(atObserved)).toEqual([['1024-2212-2', 415.4]]);
    expect(seps(atMean)).toEqual([['1024-2212-2', 415.2]]);
  });
});

describe("witnessHipparcos — HIP2 carried to each observed cell's own epochs", () => {
  it("splits a photocentre pair on the entries' observed cells", () => {
    const pair = (tyc: string, observed: ObservedPosition) =>
      tycho2Row(tyc, { raDeg: 279.50029734, decDeg: 8.00067305, isPhotocentre: true, observed });
    const v = witnessHipparcos({ raDeg: 279.50034459, decDeg: 8.00073794, pmRaMasyr: -1.2, pmDeMasyr: -8.38 }, [
      pair('1024-2212-1', { raDeg: 279.50034139, decDeg: 8.00073056, raEpoch: 1991.84, decEpoch: 1991.75 }),
      pair('1024-2212-2', { raDeg: 279.50013611, decDeg: 8.00051333, raEpoch: 1991.83, decEpoch: 1991.75 }),
    ]);
    expect(v).toMatchObject({ kind: 'match', tyc: '1024-2212-1' });
    expect(seps(v)).toEqual([['1024-2212-1', 0.0], ['1024-2212-2', 1.1]]);
  });

  it('returns several when both entries sit inside the tolerance (HIP 7397)', () => {
    const supplement = (tyc: string, raDeg: number, decDeg: number) =>
      tycho2Row(tyc, { raDeg, decDeg, epoch: TYCHO2_ICRS_EPOCH, fromIcrs: true });
    const v = witnessHipparcos({ raDeg: 23.83990087, decDeg: 11.43444409, pmRaMasyr: 115.16, pmDeMasyr: -38.82 }, [
      supplement('624-579-1', 23.83989367, 11.43441458),
      supplement('624-579-2', 23.83990957, 11.43447656),
    ]);
    expect(v).toMatchObject({ kind: 'several', tycs: ['624-579-1', '624-579-2'] });
    expect(v.separations.every((s) => s.separationArcsec <= HIPPARCOS_WITNESS_TOLERANCE_ARCSEC)).toBe(true);
  });

  it("carries a fast mover to the entry's epoch: HIP 2552 at 1.74″/yr", () => {
    const v = witnessHipparcos({ raDeg: 8.11171915, decDeg: 67.23621557, pmRaMasyr: 1738.21, pmDeMasyr: -224.11 }, [
      tycho2Row('4027-802-1', {
        raDeg: 8.11256651, decDeg: 67.23511149, epoch: TYCHO2_ICRS_EPOCH, fromIcrs: true,
      }),
      tycho2Row('4027-803-1', {
        raDeg: 8.12272949, decDeg: 67.23559317,
        observed: { raDeg: 8.11229028, decDeg: 67.23618444, raEpoch: 1991.70, decEpoch: 1991.72 },
      }),
    ]);
    expect(v).toMatchObject({ kind: 'match', tyc: '4027-803-1' });
    expect(seps(v)).toEqual([['4027-803-1', 0.0], ['4027-802-1', 4.1]]);
  });

  it('returns none with every separation when no entry is inside the tolerance', () => {
    const v = witnessHipparcos({ raDeg: 10, decDeg: 10, pmRaMasyr: 0, pmDeMasyr: 0 }, [
      tycho2Row('1-1-1', { raDeg: 10, decDeg: 10.001 }),
    ]);
    expect(v.kind).toBe('none');
    expect(seps(v)).toEqual([['1-1-1', 3.6]]);
  });
});

describe('hipparcosSeparationFromSource — the Gaia source carried back to J1991.25', () => {
  const gaia = (raDeg: number, decDeg: number, pmRaMasyr: number, pmDecMasyr: number) =>
    ({ raDeg, decDeg, pmRaMasyr, pmDecMasyr, refEpoch: 2016 });

  it('names θ¹ Ori A, whose HIP2 proper motion is a blend', () => {
    const sep = hipparcosSeparationFromSource(
      { raDeg: 83.81588707, decDeg: -5.38727971 }, gaia(83.815945223, -5.387314083, 1.3552, 0.2501),
    );
    expect(Number(sep.toFixed(3))).toBe(0.218);
    expect(hipparcosNamesSource(sep)).toBe(true);
  });

  it('names HIP 77442 at the milliarcsecond level', () => {
    const sep = hipparcosSeparationFromSource(
      { raDeg: 237.14340123, decDeg: 28.15677697 }, gaia(237.143383235, 28.156696835, -2.8981, -11.703),
    );
    expect(Number(sep.toFixed(3))).toBe(0.015);
  });

  it('refuses HIP 83369, whose SIMBAD source sits a minute of arc away', () => {
    const sep = hipparcosSeparationFromSource(
      { raDeg: 255.58473826, decDeg: -48.9207986 }, gaia(255.559248582, -48.914482882, -1.5753, -2.7333),
    );
    expect(Math.round(sep)).toBe(64);
    expect(hipparcosNamesSource(sep)).toBe(false);
  });

  it('names a source exactly at the tolerance and refuses one past it', () => {
    expect(hipparcosNamesSource(HIPPARCOS_WITNESS_TOLERANCE_ARCSEC)).toBe(true);
    expect(hipparcosNamesSource(HIPPARCOS_WITNESS_TOLERANCE_ARCSEC + 1e-9)).toBe(false);
  });
});

describe('hipsNear — HIP2 carried forward to a Gaia epoch', () => {
  const fPup = { raDeg: 114.34216624, decDeg: -34.96857047, pmRaMasyr: -14.21, pmDeMasyr: 16.32 };
  const near = hipsNear(new Map([[37096, fPup]]));
  const at = (raDeg: number, decDeg: number) => near({ raDeg, decDeg }, 2016);
  const rounded = (hits: readonly NearHip[]) => hits.map((h) => [h.hip, Number(h.separationArcsec.toFixed(3))]);

  it('finds f Pup (HIP 37096) 0.221″ from the Gaia-only source the magnitude term admitted', () => {
    expect(rounded(at(114.342045348, -34.968397005))).toEqual([[37096, 0.221]]);
  });

  it('carries the HIP by its own proper motion: uncarried, the same source sits 0.719″ off', () => {
    const at1991 = near({ raDeg: 114.342045348, decDeg: -34.968397005 }, HIPPARCOS_EPOCH_JYEAR);
    expect(rounded(at1991)).toEqual([[37096, 0.719]]);
  });

  it('finds nothing past the tolerance', () => {
    const offset = (HIPPARCOS_FORWARD_TOLERANCE_ARCSEC + 0.05) / 3600;
    expect(at(114.342045348, -34.968397005 + offset)).toEqual([]);
  });

  it('crosses cell boundaries, RA zero and the pole, nearest first', () => {
    const pair = hipsNear(new Map([
      [1, { raDeg: 359.99999, decDeg: 0, pmRaMasyr: 0, pmDeMasyr: 0 }],
      [2, { raDeg: 0.0001, decDeg: 0, pmRaMasyr: 0, pmDeMasyr: 0 }],
      [3, { raDeg: 10, decDeg: 89.99999, pmRaMasyr: 0, pmDeMasyr: 0 }],
    ]));
    expect(pair({ raDeg: 0.00005, decDeg: 0 }, 2016).map((h) => h.hip)).toEqual([2, 1]);
    expect(pair({ raDeg: 190, decDeg: 89.99999 }, 2016).map((h) => h.hip)).toEqual([3]);
  });
});
