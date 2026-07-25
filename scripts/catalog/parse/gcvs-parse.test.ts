import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import {
  applyVariability,
  bridgeGcvsByGaia,
  parseGcvsMain,
  type VarStarData,
  type VarStarXref,
} from './gcvs-parse';
import { VAR_TYPE_DSCT, VAR_TYPE_MIRA } from '../catalog-pure';
import { makeStar } from './star-fixture';

const GCVS: Map<string, VarStarData> = new Map([
  ['R And', { periodDays: 409.2, amplitudeMag: 9.4, varType: 1 }],
  ['S Aql', { periodDays: 146.5, amplitudeMag: 3.6, varType: 1 }],
  ['T Vul', { periodDays: 4.4, amplitudeMag: 0.5, varType: 1 }],
]);

function writeGcvsMain(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gcvs-'));
  const path = join(dir, 'gcvs5.txt');
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

describe('gcvs-parse / parseGcvsMain amplitude notation', () => {
  it('reads a parenthesised min-mag cell as the full amplitude', () => {
    // β Cen shape: "( 0.045 )" means amplitude 0.045, min unknown —
    // NOT a minimum magnitude of 0.045.
    const path = writeGcvsMain([
      '199002 |bet   Cen *|140349.40 -602222.9 |BCEP      |  0.61   |(  0.045   )|            |V |            |     |     0.300          |     |B1III',
    ]);
    const out = parseGcvsMain(path);
    expect(out.get('bet Cen')).toEqual({
      periodDays: 0.3,
      amplitudeMag: 0.045,
      varType: VAR_TYPE_DSCT, // BCEP → low-amplitude p-mode bucket
    });
  });

  it('keeps computing amp = min - max for normal min-mag rows', () => {
    const path = writeGcvsMain([
      '860001 |R     Vir *|123829.94 +065919.0 |M         |  6.1    |  12.1      |            |V |45872.      |     |   145.63           |50   |M3.5IIIe-M8.5e',
    ]);
    const out = parseGcvsMain(path);
    expect(out.get('R Vir')).toEqual({
      periodDays: 145.63,
      amplitudeMag: 6.0,
      varType: VAR_TYPE_MIRA, // M → Mira
    });
  });

  it('still drops a parenthesised row without a period', () => {
    const path = writeGcvsMain([
      '059001 |alf   Aql *|195047.00 +085206.0 |DSCTC     |  0.77   |(  0.004 * )|            |V |            |     |                    |     |',
    ]);
    expect(parseGcvsMain(path).size).toBe(0);
  });
});

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

  it('keeps the lowest HIP and warns when two HIPs share a gaia_source_id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Insert the higher HIP first so a nondeterministic insertion-order
    // walk would keep the wrong name.
    const xref: VarStarXref = {
      byHip: new Map([
        [67890, 'S Aql'],
        [12345, 'R And'],
      ]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const hipToGaia = new Map<number, string>([
      [67890, '99999999'],
      [12345, '99999999'],
    ]);
    bridgeGcvsByGaia(xref, hipToGaia);
    expect(xref.byGaia.size).toBe(1);
    expect(xref.byGaia.get('99999999')).toBe('R And');
    expect(warn).toHaveBeenCalledWith(
      'GCVS bridge: gaia_source_id 99999999 reached from HIPs [12345, 67890] — keeping first.',
    );
    warn.mockRestore();
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

  it('applies the gaia-named entry when all three xref maps name the star differently', () => {
    // True triple match: every map resolves, each to a DIFFERENT GCVS
    // designation. Pins that the gaia name's period/amplitude is what
    // lands — swapping the lookup order in applyVariability fails here.
    const star = makeStar({ gaiaSourceId: '11111111', hip: 99, hd: 88 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'S Aql']]),
      byHd: new Map([[88, 'T Vul']]),
      byGaia: new Map([['11111111', 'R And']]),
    };
    const r = applyVariability([star], GCVS, xref);
    expect(r.matchedByGaia).toBe(1);
    expect(r.matchedByHip).toBe(0);
    expect(r.matchedByHd).toBe(0);
    expect(star.gcvsName).toBe('R And');
    expect(star.periodDays).toBe(409.2);
    expect(star.amplitudeMag).toBe(9.4);
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

  it('attaches the resolved GCVS designation for the search index', () => {
    const matched = makeStar({ hip: 99 });
    const unmatched = makeStar({ hip: 1 });
    const xref: VarStarXref = {
      byHip: new Map([[99, 'R And']]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    applyVariability([matched, unmatched], GCVS, xref);
    expect(matched.gcvsName).toBe('R And');
    // No cross-match → the field stays null so nothing is emitted for it.
    expect(unmatched.gcvsName).toBeNull();
  });

  it('names aperiodic variables for search without giving them a period', () => {
    // "V0645 Cen" (Proxima) resolves a designation but has no GCVS period
    // entry — searchable by name, never rendered as a pulsator.
    const aperiodic = makeStar({ hip: 42 });
    const xref: VarStarXref = {
      byHip: new Map([[42, 'V0645 Cen']]),
      byHd: new Map(),
      byGaia: new Map(),
    };
    const r = applyVariability([aperiodic], GCVS, xref);
    expect(aperiodic.gcvsName).toBe('V0645 Cen');
    expect(aperiodic.periodDays).toBe(0);
    expect(aperiodic.varType).toBe(0);
    expect(r.named).toBe(1);
    expect(r.matched).toBe(0);
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
