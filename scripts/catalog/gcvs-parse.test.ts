import { describe, it, expect } from 'vitest';

import {
  applyVariability,
  bridgeGcvsByGaia,
  type VarStarData,
  type VarStarXref,
} from './gcvs-parse';
import type { Star } from './stars-parse';

function makeStar(partial: Partial<Star>): Star {
  return {
    x: 0, y: 0, z: 0,
    absmag: 0,
    ci: 0,
    spectClass: 0,
    lumClass: 0,
    physicalRadius: 1,
    conIndex: 255,
    flags: 0,
    proper: null,
    bayer: null,
    hip: null,
    hd: null,
    hr: null,
    flam: null,
    gl: null,
    gaiaSourceId: null,
    spectDisplay: null,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
    athygDist: null,
    athygDistSrc: null,
    ...partial,
  };
}

const GCVS: Map<string, VarStarData> = new Map([
  ['R And', { periodDays: 409.2, amplitudeMag: 9.4 }],
  ['S Aql', { periodDays: 146.5, amplitudeMag: 3.6 }],
  ['T Vul', { periodDays: 4.4, amplitudeMag: 0.5 }],
]);

describe('gcvs-parse / bridgeGcvsByGaia', () => {
  it('promotes every byHip xref onto gaia_source_id when the walk knows the HIP', () => {
    const xref: VarStarXref = {
      byHip: new Map([
        [1, 'R And'],
        [2, 'S Aql'],
      ]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const hipToGaia = new Map<number, string>([
      [1, '11111111'],
      [2, '22222222'],
    ]);
    bridgeGcvsByGaia(xref, hipToGaia);
    expect(xref.byGaia.size).toBe(2);
    expect(xref.byGaia.get('11111111')).toBe('R And');
    expect(xref.byGaia.get('22222222')).toBe('S Aql');
  });

  it('skips byHip xrefs whose HIP is not in the walk', () => {
    const xref: VarStarXref = {
      byHip: new Map([
        [1, 'R And'],
        [2, 'S Aql'],
      ]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const hipToGaia = new Map<number, string>([[1, '11111111']]);
    bridgeGcvsByGaia(xref, hipToGaia);
    expect(xref.byGaia.size).toBe(1);
    expect(xref.byGaia.get('11111111')).toBe('R And');
  });

  it('clears any pre-existing byGaia entries before rebuilding', () => {
    const xref: VarStarXref = {
      byHip: new Map([[1, 'R And']]),
      byHd: new Map(),
      byGaia: new Map([['stale', 'Z Whatever']]),
    };
    bridgeGcvsByGaia(xref, new Map([[1, '11111111']]));
    expect(xref.byGaia.has('stale')).toBe(false);
    expect(xref.byGaia.get('11111111')).toBe('R And');
  });
});

describe('gcvs-parse / applyVariability priority', () => {
  it('resolves via gaia first when a star has gaia_source_id', () => {
    const star = makeStar({ gaiaSourceId: '11111111', hip: 99, hd: 99 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'S Aql']]),
      byHd: new Map([[99, 'S Aql']]),
      byGaia: new Map([['11111111', 'R And']]),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.matched).toBe(1);
    expect(r.matchedByGaia).toBe(1);
    expect(r.matchedByHip).toBe(0);
    expect(r.matchedByHd).toBe(0);
    // The gaia path won, so the star's period matches R And.
    expect(star.periodDays).toBe(409.2);
  });

  it('falls back to hip when gaia is absent', () => {
    const star = makeStar({ hip: 99, hd: 88 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'S Aql']]),
      byHd: new Map([[88, 'R And']]),
      byGaia: new Map(),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.matchedByGaia).toBe(0);
    expect(r.matchedByHip).toBe(1);
    expect(r.matchedByHd).toBe(0);
    expect(star.periodDays).toBe(146.5); // S Aql
  });

  it('falls back to hd when neither gaia nor hip matches', () => {
    const star = makeStar({ hd: 88 });
    const xref: VarStarXref = {
      byHip: new Map(),
      byHd: new Map([[88, 'T Vul']]),
      byGaia: new Map(),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.matchedByGaia).toBe(0);
    expect(r.matchedByHip).toBe(0);
    expect(r.matchedByHd).toBe(1);
    expect(star.periodDays).toBe(4.4);
  });

  it('falls through to hip when the gaia lookup misses', () => {
    // Star has a gaia_source_id, but it's not in the bridged byGaia. HIP
    // still resolves the variability — exercises the fallthrough.
    const star = makeStar({ gaiaSourceId: '00000000', hip: 99 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'R And']]),
      byHd: new Map(),
      byGaia: new Map([['7777', 'S Aql']]),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.matchedByGaia).toBe(0);
    expect(r.matchedByHip).toBe(1);
    expect(star.periodDays).toBe(409.2);
  });

  it('skips stars whose resolved GCVS name lacks a period entry', () => {
    const star = makeStar({ hip: 99 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'Unknown Variable']]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.matched).toBe(0);
    expect(star.periodDays).toBe(0);
    expect(star.amplitudeMag).toBe(0);
  });

  it('returns disjoint per-source counts that sum to total matched', () => {
    const stars = [
      makeStar({ gaiaSourceId: '11111111' }),  // gaia
      makeStar({ hip: 50 }),                    // hip
      makeStar({ hd: 60 }),                     // hd
      makeStar({}),                             // no IDs, no match
    ];
    const xref: VarStarXref = {
      byHip: new Map([[50, 'S Aql']]),
      byHd: new Map([[60, 'T Vul']]),
      byGaia: new Map([['11111111', 'R And']]),
    };
    const r = applyVariability(stars, GCVS, xref);
    expect(r.matchedByGaia).toBe(1);
    expect(r.matchedByHip).toBe(1);
    expect(r.matchedByHd).toBe(1);
    expect(r.matched).toBe(3);
  });
});
