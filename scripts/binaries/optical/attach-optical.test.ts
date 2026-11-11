import { describe, expect, it } from 'vitest';
import { wdsPair } from '../../wds/wds-fixture';
import type { Stage3Result } from '../astrometry/attach-astrometry';
import type { MeasuredAstrometry } from '../astrometry/routes-pure';
import { gaiaAstrometryRow } from '../load/load-fixture';
import { NO_ORBIT } from '../orbits/select-orbit-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed, indices } from '../resolve/resolve-fixture';
import { attachStage5, stage5Counts, stage5Rates } from './attach-optical';
import { stage5Report } from './stage5-report-pure';

const W = '22039-2451';
const astrometry = (parallaxMas: number): MeasuredAstrometry => ({
  astrometryVia: 'gaia_5p', raDeg: 0, decDeg: 0, parallaxMas, parallaxErrorMas: 0.1, pmraMasyr: 0, pmdecMasyr: 0, refEpoch: 2016,
});

function run(pairs: readonly DecomposedPair[], masses: readonly number[]) {
  const stage3: Stage3Result = {
    pairs,
    astrometry: new Map(pairs.map((p) => [p, { primary: astrometry(21.2), secondary: astrometry(21.2) }])),
    siblingClaimed: [],
    nssOutcomes: [],
  };
  const ix = indices({
    srcToAstrometry: new Map([
      ['1', gaiaAstrometryRow({ sourceId: '1', parallaxMas: 21.29, parallaxErrorMas: 0.05, pmraMasyr: 0.0, pmdecMasyr: 0.0 })],
      ['2', gaiaAstrometryRow({ sourceId: '2', parallaxMas: 21.19, parallaxErrorMas: 0.05, pmraMasyr: 22.4, pmdecMasyr: 0.0 })],
      ['3', gaiaAstrometryRow({ sourceId: '3', parallaxMas: 21.25, parallaxErrorMas: 0.05, pmraMasyr: 1.0, pmdecMasyr: 0.0 })],
    ]),
  });
  return attachStage5(stage3, { orbits: new Map(pairs.map((p) => [p, NO_ORBIT])) }, new Map(pairs.map((p, i) => [p, masses[i]])), ix);
}

const side = (gaiaSourceId: string) => ({ gaiaSourceId, resolveVia: 'orb6_hip' as const });
const ac = decomposed(wdsPair({ wdsId: W, components: 'AC', rhoLast: 28.0 }), { primary: side('1'), secondary: side('2') });
const ab = decomposed(wdsPair({ wdsId: W, components: 'AB', rhoLast: 3.4 }), { primary: side('1'), secondary: side('3') });

describe('attachStage5', () => {
  it('budgets A\'s orbital PM from the system\'s tighter AB pair, and rejects the same Δpm without it', () => {
    expect(run([ac, ab], [1.2, 1.6]).optical.get(ac)).toBe('gaia_kept');
    expect(run([ac], [1.2]).optical.get(ac)).toBe('gaia_rejected');
  });

  it('counts every tag, zeros included, and rates the rejections over every pair', () => {
    const counts = stage5Counts(run([ac], [1.2]));
    expect(counts.optical_gaia_rejected).toBe(1);
    expect(counts.optical_mag_heuristic_kept).toBe(0);
    expect(Object.keys(counts)).toHaveLength(12);
    expect(stage5Rates(counts).optical_rejected_rate).toBe(1);
  });

  it('logs the cascade, the rate, and no sample line when the separation gate dropped nothing', () => {
    expect(stage5Report(run([ac, ab], [1.2, 1.6]))).toEqual([
      expect.stringMatching(/^optical-pair cascade: wds_notes_kept=0, .*gaia_kept=2,/),
      'optical rejected rate: 0.0% (0 / 2)',
    ]);
  });
});
