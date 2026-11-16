import { describe, expect, it } from 'vitest';

import { invariantViolations } from '../../catalog/lineage/lineage-invariant-pure';
import { sortLineageLines, stageLineageText } from '../../catalog/lineage/lineage-row-pure';
import { orb6Entry, wdsPair } from '../../wds/wds-fixture';
import type { Orb6Entry } from '../../wds/wds-pure';
import { measured } from '../astrometry/astrometry-fixture';
import { mscOrbit } from '../load/load-fixture';
import type { MscOrbitRow } from '../load/msc-pure';
import { decomposed } from '../resolve/resolve-fixture';
import type { Stage4Result } from './attach-orbits';
import { nssOrbitalRow } from './nss-fixture';
import { ORBITS_CODES, ORBITS_INVARIANTS, orbitsCounts, orbitsLineageLines, orbitsLineageRows } from './orbits-lineage-pure';
import { selectOrbit } from './select-orbit-pure';

interface PairCase {
  readonly wdsId?: string;
  readonly components?: string;
  readonly rho?: number;
  readonly orb6?: readonly Orb6Entry[];
  readonly msc?: readonly MscOrbitRow[];
  readonly nss?: boolean;
}

function stage4(...cases: readonly PairCase[]): Stage4Result {
  const decisions = new Map();
  const srcToNss = new Map([['42', nssOrbitalRow({ sourceId: '42', periodDays: 200 })]]);
  for (const c of cases) {
    const p = decomposed(wdsPair({ wdsId: c.wdsId ?? 'W', components: c.components ?? 'AB', rhoLast: c.rho ?? 0 }), {
      primary: { gaiaSourceId: c.nss ? '42' : null, hip: 7 },
      secondary: { gaiaSourceId: null },
    });
    const a = measured();
    decisions.set(p, selectOrbit(p, { primary: a, secondary: a }, { orb6: c.orb6 ?? [], msc: c.msc ?? [], systemParallaxMas: null }, srcToNss));
  }
  return { decisions };
}

describe('orbitsLineageRows', () => {
  it('writes the chosen source citing its row, then each candidate passed over with its rule, under the pair\'s founding row', () => {
    const rows = [...orbitsLineageRows(stage4({ orb6: [orb6Entry({ grade: 2 })], msc: [mscOrbit()], nss: true }))];
    expect(rows.map((r) => [r.key, r.role, r.code, r.evidence.map((e) => e.split(':')[0]).join('|')])).toEqual([
      ['wds:W/TST   1/AB', 'outcome', 'orbits.source.orb6', 'orb6'],
      ['wds:W/TST   1/AB', 'refused', 'orbits.passed.gaia-nss.outranked', 'gaia-dr3-nss'],
      ['wds:W/TST   1/AB', 'refused', 'orbits.passed.msc.outranked', 'msc-orbits'],
    ]);
    expect(rows[0].params).toBe('{"primary":"A","primary_gaia":"42","primary_hip":"hip:7","secondary":"B"}');
  });

  it('writes none, with no evidence, for a pair nothing on file reaches', () => {
    expect([...orbitsLineageRows(stage4({ msc: [mscOrbit()], rho: 3 }))].map((r) => [r.code, r.evidence.length])).toEqual([
      ['orbits.source.none', 0], ['orbits.passed.msc.measured-separation', 1],
    ]);
  });

  it('writes lines the stage writer accepts', () => {
    expect(() => stageLineageText(ORBITS_CODES, sortLineageLines(orbitsLineageLines(stage4({ nss: true }, {}))))).not.toThrow();
  });
});

describe('orbitsCounts', () => {
  it('counts each pair once, by its source', () => {
    expect(orbitsCounts(orbitsLineageLines(stage4({ orb6: [orb6Entry()], nss: true }, { nss: true }, {})))).toEqual({
      orbit_orb6: 1, orbit_gaia_nss: 1, orbit_orb6_spectroscopic: 0, orbit_msc: 0, orbit_none: 1,
    });
  });
});

describe('ORBITS_INVARIANTS', () => {
  it('fails an unreadable row it does not name, and lists the named rows no line carries', () => {
    const unreadable = orb6Entry({ grade: 8, pUnit: '0' });
    const lines = sortLineageLines(orbitsLineageLines(stage4({ orb6: [unreadable] })));
    const held = invariantViolations(ORBITS_INVARIANTS, lines);
    expect(held.map((v) => [v.invariant.code, v.rows.map((r) => r.key), v.stale.length])).toEqual([
      ['orbits.passed.orb6.unreadable', [], 0],
      ['orbits.passed.gaia-nss.unreadable', [], 0],
      ['orbits.passed.orb6-spectroscopic.unreadable', ['wds:W/TST   1/AB'], 2],
      ['orbits.passed.msc.unreadable', [], 0],
    ]);
  });
});
