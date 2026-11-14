import { describe, expect, it } from 'vitest';

import { discovererKey } from '../component-tokens-pure';
import { blankPair, orb6Entry, wdsPair } from '../../wds/wds-fixture';
import { athygRow, gaia5pRow, mscOrbit, mscSystem } from './load-fixture';
import { assembleReferenceCatalogs, stage1Counts, type Stage1Inputs } from './reference-catalogs';
import { stage1Report } from './stage1-report-pure';

function inputs(over: Partial<Stage1Inputs> = {}): Stage1Inputs {
  return {
    wdsSumm: [
      wdsPair({ wdsId: '10000+0000', components: 'AB' }),
      wdsPair({ wdsId: '10000+0000', components: 'AB', nObs: 4 }),
      blankPair('20000+0000'),
      blankPair('30000+0000', 'TST   2'),
    ],
    orb6: {
      entries: [
        orb6Entry({ wdsId: '20000+0000', components: '' }),
        orb6Entry({ wdsId: '30000+0000', discoverer: 'TST   2', components: 'YY' }),
      ],
      grades: ['graded', 'graded'],
    },
    orb6ComponentOverrides: new Map([[discovererKey('30000+0000', 'TST   2'), 'Aa,Ab']]),
    athyg: [athygRow({ hip: 1, gaia: '11', vMag: 1 }), athygRow({ hip: 2, gaia: '22', vMag: 5 })],
    ccdm: { hipToCcdm: new Map(), ccdmToHips: new Map(), rows: 0 },
    hip2: new Map(),
    hipToGaia: new Map(),
    tycToGaia: new Map(),
    nss: new Map(),
    astrometry: new Map([
      ['11', gaia5pRow({ sourceId: '11', gMag: 9 })],
      ['99', gaia5pRow({ sourceId: '99' })],
    ]),
    astrometryExclusions: new Map([['99', 'blend']]),
    simbadWdsXids: new Map(),
    simbadSptypeByOid: new Map(),
    componentSptypeOverrides: new Map(),
    msc: { systems: [mscSystem(), mscSystem({ prim: 'Aa', sec: 'Ab', parent: 'A' })], orbits: [mscOrbit()], components: [] },
    ...over,
  };
}

describe('assembleReferenceCatalogs', () => {
  const c = assembleReferenceCatalogs(inputs());

  it('runs the passes in order: dedup, curated letters, orphans, rescue, MSC inner pairs', () => {
    expect(c.pairs.map((p) => `${p.wdsId} ${p.discoverer} ${p.components}`)).toEqual([
      '10000+0000 TST   1 AB',
      '20000+0000 TST   1 AB',
      '30000+0000 TST   2 ',
      '30000+0000 TST   2 Aa,Ab',
      '10000+0000 MSC Aa,Ab',
    ]);
    expect(c.orb6.map((e) => e.components)).toEqual(['AB', 'Aa,Ab']);
    expect(c.blankRescue).toEqual(['rescued', 'donor']);
    expect(c.wdsDedup).toEqual(['dropped', 'kept', 'kept', 'kept']);
    expect(c.orb6Overrides).toEqual(['unchanged', 'applied']);
  });

  it('drops excluded astrometry before the magnitude gate weighs AT-HYG', () => {
    expect(c.astrometryExclusion).toEqual(['kept', 'excluded']);
    expect(c.athyg.map((r) => r.gaia)).toEqual([null, '22']);
  });

  it('counts its snapshot keys from the outcomes', () => {
    expect(stage1Counts(c)).toEqual({
      wds_duplicate_pair_rows_dropped: 1,
      msc_orbits_unmapped: 0,
      xwalk_hip_mag_rejected: 0,
      athyg_gaia_mag_rejected: 1,
      synthesized_orb6_orphan_pairs: 1,
      synthesized_msc_inner_pairs: 1,
      blank_components_rescued: 1,
      blank_components_deferred: 0,
    });
  });

  it('fails the row bands a truncated input misses', () => {
    expect(c.checks.map((check) => check.kind)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail']);
  });

  it('reports AT-HYG Gaia coverage outside its band', () => {
    const sparse = assembleReferenceCatalogs(inputs({ athyg: [athygRow({ hip: 1 }), athygRow({ hip: 2, gaia: '22' })] }));
    expect(stage1Report(sparse).at(-1)).toMatch(/^WARNING: AT-HYG gaia coverage 50\.0% outside/);
    expect(stage1Report(c).some((line) => line.startsWith('WARNING'))).toBe(false);
  });

  it('reports an empty AT-HYG as coverage n/a, outside the band', () => {
    const report = stage1Report(assembleReferenceCatalogs(inputs({ athyg: [] })));
    expect(report).toContain('0 / 0 AT-HYG rows carry gaia (n/a)');
    expect(report.at(-1)).toBe('WARNING: AT-HYG gaia coverage n/a outside [90.0%, 100.0%] — input drift suspected');
  });
});
