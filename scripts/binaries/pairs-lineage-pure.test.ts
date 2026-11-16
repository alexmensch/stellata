import { describe, expect, it } from 'vitest';

import { SEEDED_BRANCH, seededCodeCheck } from '../catalog/lineage/count-block-fixture';
import { foldStageLines, sortLineageLines, stageLineageText } from '../catalog/lineage/lineage-row-pure';
import { blankPair, orb6Entry, wdsPair } from '../wds/wds-fixture';
import { mscOrbit } from './load/load-fixture';
import { nssRow } from './orbits/nss-fixture';
import { subResolutionPair } from './load/subdivide-pure';
import { codeEffects } from '../catalog/lineage/reason-codes/reason-codes-pure';
import { OPTICAL_VIA, type OpticalVia } from './optical/optical-tiers-pure';
import { PAIRS_CODES, pairsIdentity, pairsLineageLines, pairsLineageRows, type PairDecisions } from './pairs-lineage-pure';
import type { DecomposedPair } from './resolve/components-pure';
import { decomposed } from './resolve/resolve-fixture';

const GAIA = '4000000000000000001';

const kept = decomposed(wdsPair({ wdsId: '00001+0001', discoverer: 'STF   1', components: 'AB' }), {
  primary: { gaiaSourceId: GAIA, hip: 71683 }, secondary: { gaiaSourceId: null, hip: null },
});
const rescued = { ...blankPair('00002+0002', 'BU    2'), components: 'AB' };
const placeless = decomposed(rescued, { primary: { gaiaSourceId: null }, secondary: { gaiaSourceId: null } });
const orphanEntry = orb6Entry({ wdsId: '00003+0003', discoverer: 'HO    3', components: 'Aa,Ab' });
const orphan = subResolutionPair(orphanEntry.origin, '00003+0003', 'HO    3', 'Aa,Ab', null);
const msc = decomposed(subResolutionPair(
  mscOrbit({ wdsId: '00004+0004', syst: 'Aab,Ac' }).origin, '00004+0004', 'MSC', 'Aa,Ab', null,
));
const nss = decomposed(subResolutionPair(nssRow({ sourceId: GAIA }).origin, '00005+0005', 'GNSS', 'Aa,Ab', null));
const duplicate = wdsPair({ wdsId: '17247-3412', discoverer: 'WSI  62', components: 'CD' });
const donor = blankPair('00003+0003', 'HO    3');

const decisions: PairDecisions = {
  reference: {
    wdsDedup: [{ row: duplicate, outcome: 'dropped' }, { row: kept.pair, outcome: 'kept' }],
    blankRescue: [
      { row: blankPair('00002+0002', 'BU    2'), outcome: 'rescued' },
      { row: blankPair('00006+0006'), outcome: 'deferred' },
      { row: donor, outcome: 'donor', donatedTo: [orphan] },
      { row: blankPair('00007+0007'), outcome: 'enumerated' },
    ],
  },
  optical: {
    optical: new Map([[kept, 'gaia_kept'], [placeless, 'mag_heuristic_kept'], [msc, 'orbit_kept'], [nss, 'sep_limit_rejected']]),
  },
  multiples: { droppedNoPosition: [placeless], rows: [] },
};

describe('pairsLineageRows', () => {
  it('writes a row per decided pair row, keyed on the row that founded it', () => {
    expect([...pairsLineageRows(decisions)].map((r) => [r.key, r.code, r.params, r.evidence])).toEqual([
      ['wds:17247-3412/WSI  62/CD', 'pairs.duplicate-row', '', []],
      ['wds:00006+0006/TST   1/', 'pairs.blank-deferred', '', []],
      ['wds:00003+0003/HO    3/', 'pairs.blank-donor', '', ['orb6:00003+0003/HO    3/Aa,Ab']],
      ['wds:00007+0007/TST   1/', 'pairs.blank-enumerated', '', []],
      [
        'wds:00001+0001/STF   1/AB', 'pairs.optical.gaia-kept',
        `{"primary":"A","primary_gaia":"${GAIA}","primary_hip":"hip:71683","secondary":"B"}`, [],
      ],
      ['wds:00002+0002/BU    2/', 'pairs.optical.mag-heuristic-kept', '{"primary":"A","secondary":"B"}', []],
      ['msc-orbits:00004+0004/Aab,Ac', 'pairs.optical.orbit-kept', '{"primary":"Aa","primary_gaia":"0","secondary":"Ab","secondary_gaia":"0"}', []],
      [`gaia-dr3-nss:${GAIA}`, 'pairs.rejected.sep-limit', '{"primary":"Aa","primary_gaia":"0","secondary":"Ab","secondary_gaia":"0"}', []],
      ['wds:00002+0002/BU    2/', 'pairs.no-position', '{"primary":"A","secondary":"B"}', []],
    ]);
  });

  it('writes lines the stage writer accepts, every row an outcome', () => {
    expect([...pairsLineageRows(decisions)].every((r) => r.role === 'outcome')).toBe(true);
    expect(() => stageLineageText(PAIRS_CODES, sortLineageLines(pairsLineageLines(decisions)))).not.toThrow();
  });
});

describe('PAIRS_CODES', () => {
  it('declares one optical code per Stage 5 tag beside the duplicate, three blank and no-position codes', () => {
    expect(PAIRS_CODES.live).toHaveLength(OPTICAL_VIA.length + 5);
  });

  it('folds one row per decision, a position-less pair counted under its tag and no-position both', () => {
    const counts = foldStageLines(PAIRS_CODES, pairsLineageLines(decisions));
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(9);
    expect([counts['pairs.optical.mag-heuristic-kept'], counts['pairs.no-position']]).toEqual([1, 1]);
  });

  it('reaches the count snapshot with a newly declared code', () => {
    const { drift, refreshed } = seededCodeCheck(PAIRS_CODES, pairsLineageLines(decisions));
    expect(drift.drifted).toBe(true);
    expect(drift.report).toContain(`pairs.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });

  it('retires on every rejecting tier, and on nothing else', () => {
    const effects = codeEffects([PAIRS_CODES]);
    const retiring = PAIRS_CODES.live.filter((code) => effects.get(code) === 'retire');
    expect(retiring).toEqual(PAIRS_CODES.live.filter((code) => code.startsWith('pairs.rejected.')));
    expect(retiring).toHaveLength(OPTICAL_VIA.filter((via) => via.endsWith('_rejected')).length);
  });
});

describe('pairsIdentity', () => {
  const pairIn = (wdsId: string, discoverer: string, components: string) => decomposed(
    wdsPair({ wdsId, discoverer, components }), { primary: { gaiaSourceId: null }, secondary: { gaiaSourceId: null } },
  );
  const rejected = pairIn('00008+0008', 'STF   8', 'AB');
  const truncated = pairIn('00009+0009', 'STF   9', 'Aa1,2');
  type Row = PairDecisions['multiples']['rows'][number];
  const identityOf = (rows: readonly Row[], optical: ReadonlyMap<DecomposedPair, OpticalVia>) => (
    pairsIdentity({ optical: { optical }, multiples: { droppedNoPosition: [], rows } }).map((r) => [r.key, r.designations])
  );

  it('names each side of a rejected pair no multiples.tsv row composes, keyed on the pair', () => {
    expect(identityOf([], new Map([[rejected, 'gaia_rejected'], [kept, 'gaia_kept']]))).toEqual([
      ['wds:00008+0008/STF   8/AB', ['synth:00008+0008-A', 'synth:00008+0008-B']],
    ]);
  });

  it('leaves out a side a kept pair still ships, and a pair with no side left', () => {
    const a: Row = { systemId: '00008+0008-AC', comp: 'A', orbitRole: 'primary' };
    const b: Row = { systemId: '00008+0008-BD', comp: 'B', orbitRole: 'primary' };
    expect(identityOf([a], new Map([[rejected, 'sep_limit_rejected']]))).toEqual([
      ['wds:00008+0008/STF   8/AB', ['synth:00008+0008-B']],
    ]);
    expect(identityOf([a, b], new Map([[rejected, 'sep_limit_rejected']]))).toEqual([]);
  });

  it('keys a truncated secondary on its canonical letter, as promotion does', () => {
    expect(identityOf([], new Map([[truncated, 'mag_heuristic_rejected']]))).toEqual([
      ['wds:00009+0009/STF   9/Aa1,2', ['synth:00009+0009-Aa1', 'synth:00009+0009-Aa2']],
    ]);
    const shipped: Row[] = [
      { systemId: '00009+0009-Aa1,2', comp: 'Aa1', orbitRole: 'primary' },
      { systemId: '00009+0009-Aa1,2', comp: '2', orbitRole: 'secondary' },
    ];
    expect(identityOf(shipped, new Map([[truncated, 'mag_heuristic_rejected']]))).toEqual([]);
  });
});
