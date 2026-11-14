import { describe, expect, it } from 'vitest';

import { columnTable } from '../../util/tsv/table-pure';
import { buildMscLookup } from './msc-pure';
import { buildIndices, parseCcdmIndex, scrubAthygGaia, type IndexInputs } from './indices-pure';
import { FIXTURE, athygRow, gaia5pRow } from './load-fixture';
import type { AthygRow } from './athyg-pure';
import type { GaiaAstrometryRow } from '../../catalog/sources/gaia-astrometry-source';

function indices(over: Partial<IndexInputs> = {}) {
  return buildIndices({
    athyg: [], hip2: new Map(), hipToGaia: new Map(), tycToGaia: new Map(), srcToNss: new Map(),
    srcToAstrometry: new Map(), ccdm: { hipToCcdm: new Map(), ccdmToHips: new Map(), rows: 0 },
    simbadWdsSpectra: new Map(), componentSptypeOverrides: new Map(), athygGaiaMagRejected: [],
    msc: buildMscLookup([], [], []),
    ...over,
  });
}

function withGate(athyg: AthygRow[], hipToGaia: Map<number, string>, astrometry: GaiaAstrometryRow[]) {
  const srcToAstrometry = new Map(astrometry.map((r) => [r.ref.row, r]));
  const scrubbed = scrubAthygGaia(athyg, srcToAstrometry);
  return { scrubbed, idx: indices({ athyg: scrubbed.rows, hipToGaia, srcToAstrometry, athygGaiaMagRejected: scrubbed.rejected }) };
}

describe('buildIndices', () => {
  it('builds the three AT-HYG views', () => {
    const idx = indices({
      athyg: [
        athygRow({ hip: 1, tyc: '100-1-1', gaia: '111' }),
        athygRow({ hip: 2, gaia: '222' }),
        athygRow({ tyc: '200-2-1' }),
      ],
    });
    expect([...idx.hipToAthyg.keys()]).toEqual([1, 2]);
    expect([...idx.tycToAthyg.keys()]).toEqual(['100-1-1', '200-2-1']);
    expect([...idx.srcToAthyg.keys()]).toEqual(['111', '222']);
  });

  it('inverts the HIP cross-walk, a shared source keeping its first HIP', () => {
    expect(indices({ hipToGaia: new Map([[1, '100'], [2, '200']]) }).srcToHip).toEqual(new Map([['100', 1], ['200', 2]]));
    expect(indices({ hipToGaia: new Map([[1, '100'], [2, '100']]) }).srcToHip.get('100')).toBe(1);
  });
});

describe('parseCcdmIndex', () => {
  it('keys every HIP with a CCDM identifier and gathers its siblings (α Cen)', () => {
    const { hipToCcdm, ccdmToHips, rows } = parseCcdmIndex(columnTable(FIXTURE, [
      'HIP\tCCDM\tMultFlag', '71683\t14396-6050\t', '71681\t14396-6050\t', '70890\t14396-6050\t', '99999\t          \tO',
    ].join('\n')));
    expect(hipToCcdm.get(71683)).toBe('14396-6050');
    expect(ccdmToHips.get('14396-6050')).toEqual([71683, 71681, 70890]);
    expect(hipToCcdm.has(99999)).toBe(false);
    expect(rows).toBe(4);
  });
});

describe('the magnitude gate on HIP-anchored Gaia bindings', () => {
  it('rejects a cross-walk binding fainter than the star can be (Castor A)', () => {
    const { idx } = withGate([athygRow({ hip: 36850, vMag: 1.58 })], new Map([[36850, '892']]), [gaia5pRow({ sourceId: '892', gMag: 2.92 })]);
    expect(idx.hipToGaia.has(36850)).toBe(false);
    expect(idx.srcToHip.has('892')).toBe(false);
    expect(idx.xwalkMagRejected).toEqual([{ hip: 36850, sourceId: '892' }]);
  });

  it('keeps a binding inside the blend ceiling and a red star brighter in G', () => {
    const { idx } = withGate(
      [athygRow({ hip: 93506, vMag: 2.60 }), athygRow({ hip: 1, vMag: 8.0 })],
      new Map([[93506, '77'], [1, '5']]),
      [gaia5pRow({ sourceId: '77', gMag: 3.25 }), gaia5pRow({ sourceId: '5', gMag: 6.0 })],
    );
    expect(idx.hipToGaia).toEqual(new Map([[93506, '77'], [1, '5']]));
    expect(idx.xwalkMagRejected).toEqual([]);
  });

  it('trusts what it cannot weigh: no V, an unpulled source, no G', () => {
    const { idx } = withGate(
      [athygRow({ hip: 1 }), athygRow({ hip: 2, vMag: 5 }), athygRow({ hip: 3, vMag: 5 })],
      new Map([[1, '10'], [2, '20'], [3, '30']]),
      [gaia5pRow({ sourceId: '30', gMag: null })],
    );
    expect(idx.hipToGaia.size).toBe(3);
  });

  it('empties an AT-HYG gaia cell it refuses and keeps the bare HIP (α Cen B)', () => {
    const { idx, scrubbed } = withGate(
      [athygRow({ hip: 71681, gaia: '587', vMag: 1.35 })], new Map(), [gaia5pRow({ sourceId: '587', gMag: 20.95 })],
    );
    expect(scrubbed.rows[0].gaia).toBeNull();
    expect(idx.srcToAthyg.has('587')).toBe(false);
    expect(idx.athygGaiaMagRejected).toEqual([{ hip: 71681, sourceId: '587' }]);
    expect(idx.hipToAthyg.has(71681)).toBe(true);
  });
});
