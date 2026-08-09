import { describe, expect, it } from 'vitest';
import { makeDustField, type DustParams } from './dust-grid';
import { buildMarchPlan, planColumn, planMeasuredColumn, withAnalytic } from './march-plan';
import {
  SOL_GALACTOCENTRIC_PC,
  galacticDirection,
  sightlineColumn,
  type Vec3,
} from '../../../src/client/milkyway/milkyway-column-pure';

const GRID = 32;
const PARAMS: DustParams = {
  gridSize: GRID,
  chunkSize: GRID / 4,
  chunksPerAxis: 4,
  boundsHalfPc: 1250,
  voxelPc: (2 * 1250) / GRID,
  densityMin: 1e-7,
  densityMax: 0.2,
  avPerDensityPerPc: 2.742,
};
/** Code 0 decodes to the noise floor, so the measured tier contributes nothing
 *  and the analytic one is the whole cascade. */
const empty = makeDustField(PARAMS, new Uint8Array(GRID ** 3));

const SOL: Vec3 = SOL_GALACTOCENTRIC_PC;
const OFF_SOL: Vec3 = [SOL_GALACTOCENTRIC_PC[0] + 3000, 0, 0];
/** Outside BOTH proxy ellipsoids and outside coverage: the extragalactic
 *  vantage, where both components run their own foreground pre-march. */
const ABOVE_DISC: Vec3 = [0, 0, 20_000];

const SIGHTLINES: Array<{ label: string; origin: Vec3; lDeg: number; bDeg: number }> = [
  { label: 'Sol, Galactic centre', origin: SOL, lDeg: 0, bDeg: 0 },
  { label: 'Sol, anticentre', origin: SOL, lDeg: 180, bDeg: 0 },
  { label: 'Sol, NGP', origin: SOL, lDeg: 0, bDeg: 90 },
  { label: 'Sol, rift edge', origin: SOL, lDeg: 0, bDeg: 8 },
  { label: '3 kpc off-Sol', origin: OFF_SOL, lDeg: 180, bDeg: 4 },
  { label: '20 kpc above the disc', origin: ABOVE_DISC, lDeg: 0, bDeg: -90 },
  { label: '20 kpc above, oblique', origin: ABOVE_DISC, lDeg: 30, bDeg: -70 },
];

describe('the plan is the shipped CPU mirror', () => {
  it('reproduces a dust-free column exactly, everywhere', () => {
    for (const { label, origin, lDeg, bDeg } of SIGHTLINES) {
      const dir = galacticDirection(lDeg, bDeg);
      const plan = buildMarchPlan(empty, origin, dir);
      expect(
        planColumn(plan, () => 0),
        label,
      ).toBe(sightlineColumn(origin, dir, { dustEnabled: false }));
    }
  });

  it('integrates the analytic tier finer than the shipped per-step midpoint does', () => {
    // Outside coverage the plan's analytic term spans the whole ray, as the
    // shipped slab does — but at 2 substeps per scale height against the
    // shader's one sample per march step. The gap is the shipped march's own
    // quadrature error, and it is shared by every read the sweep compares, so
    // it cancels in ΔS. Pinned so a change to either side surfaces here.
    const gap = (lDeg: number, bDeg: number): number => {
      const dir = galacticDirection(lDeg, bDeg);
      const plan = buildMarchPlan(empty, ABOVE_DISC, dir);
      expect(plan.cov.hit).toBe(false);
      return -2.5 * Math.log10(planColumn(plan, withAnalytic(() => 0)) / sightlineColumn(ABOVE_DISC, dir));
    };
    expect(gap(0, -90)).toBeCloseTo(0.0125, 4);
    expect(gap(30, -70)).toBeCloseTo(0.0027, 4);
  });

  it('gives each component its own foreground column when the camera is outside both', () => {
    const dir = galacticDirection(0, -90);
    const plan = buildMarchPlan(empty, ABOVE_DISC, dir);
    const [disc, bulge] = plan.components;
    expect(disc.name).toBe('disc');
    expect(bulge.name).toBe('bulge');
    // Both pre-marches start at S_MIN_PC, and the two spans differ — so the
    // first step's analytic column must differ too.
    expect(disc.steps[0].sa).toBe(bulge.steps[0].sa);
    expect(disc.steps[0].analytic).not.toBe(bulge.steps[0].analytic);
  });
});

describe('planMeasuredColumn', () => {
  const dir = galacticDirection(0, 8);
  const plan = buildMarchPlan(empty, SOL, dir);
  const measured = (sa: number, sb: number): number => sb - sa;

  it('selects a component by name, not by array order', () => {
    const disc = planMeasuredColumn(plan, 'disc', measured);
    const bulge = planMeasuredColumn(plan, 'bulge', measured);
    expect(disc).toBeGreaterThan(bulge);
    expect(disc).toBeCloseTo(
      plan.components.find((c) => c.name === 'disc')!.steps.at(-1)!.sb - 1,
      6,
    );
  });

  it('returns zero for a component this sightline never entered', () => {
    const missesBulge = buildMarchPlan(empty, SOL, galacticDirection(180, 0));
    expect(missesBulge.components.some((c) => c.name === 'bulge')).toBe(false);
    expect(planMeasuredColumn(missesBulge, 'bulge', measured)).toBe(0);
  });
});
