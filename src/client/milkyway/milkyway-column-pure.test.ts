import { describe, expect, it } from 'vitest';
import {
  BULGE_COMPONENT,
  DISC_COMPONENT,
  SOL_GALACTOCENTRIC_PC,
  type Vec3,
  componentColumnRgb,
  foregroundDustTauRgb,
  galacticDirection,
  meshSpanPc,
  sightlineColumn,
} from './milkyway-column-pure';
import { relativeLuminance } from '../hdr/tonemap-pure';

const SOL = SOL_GALACTOCENTRIC_PC;
const TO_GC = galacticDirection(0, 0);
const REFERENCE_STEPS = 4096;

function normalise(v: Vec3): Vec3 {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** A sightline that crosses the dust slab *outside* the bulge proxy and
 *  then enters it — the case the pre-march's step distribution has to
 *  resolve, and the one an in-plane sightline doesn't exercise. */
const GRAZING_ORIGIN: Vec3 = [-20_000, 0, 600];
const GRAZING_DIR = normalise([20_000, 0, -1_200]);

describe('proxy-mesh spans from Sol', () => {
  // The whole defect: the camera is INSIDE one proxy mesh and OUTSIDE
  // the other, so only one component's march used to start at the camera.
  it('puts Sol inside the disc proxy and 3.1 kpc outside the bulge', () => {
    const disc = meshSpanPc(SOL, TO_GC, DISC_COMPONENT.meshScalePc);
    const bulge = meshSpanPc(SOL, TO_GC, BULGE_COMPONENT.meshScalePc);
    expect(disc?.sNear).toBe(0);
    expect(bulge?.sNear).toBeCloseTo(3122, 6);
    expect(bulge?.sFar).toBeCloseTo(13122, 6);
  });

  it('returns null for a sightline that misses the bulge proxy entirely', () => {
    expect(meshSpanPc(SOL, galacticDirection(180, 0), BULGE_COMPONENT.meshScalePc))
      .toBeNull();
  });
});

describe('foreground dust column', () => {
  it('carries 0.315 τ_V over the Sol→bulge-boundary sightline', () => {
    const tau = foregroundDustTauRgb(SOL, TO_GC, 3122, 0.45);
    expect(tau[1]).toBeCloseTo(0.3149, 4);
    // CCM reddening: blue extincts hardest, so the column warms as well
    // as dims what lies behind it.
    expect(tau[0]).toBeLessThan(tau[1]);
    expect(tau[2]).toBeGreaterThan(tau[1]);
  });

  // Linear-midpoint quadrature is the choice this pins: the integrand
  // rises monotonically toward the boundary, so the in-volume march's log
  // distribution would spend its samples at the wrong end.
  it('converges to a dense reference march in the plane', () => {
    const ref = foregroundDustTauRgb(SOL, TO_GC, 3122, 0.45, REFERENCE_STEPS);
    const shipped = foregroundDustTauRgb(SOL, TO_GC, 3122, 0.45);
    expect(shipped[1] / ref[1]).toBeCloseTo(1, 3);
  });

  it('converges on a grazing slab crossing outside the proxy', () => {
    const span = meshSpanPc(
      GRAZING_ORIGIN,
      GRAZING_DIR,
      BULGE_COMPONENT.meshScalePc,
    );
    expect(span).not.toBeNull();
    const args = [GRAZING_ORIGIN, GRAZING_DIR, span!.sNear, 0.45] as const;
    const ref = foregroundDustTauRgb(...args, REFERENCE_STEPS);
    // Non-trivial column, or the convergence check below proves nothing.
    expect(ref[1]).toBeGreaterThan(0.05);
    expect(foregroundDustTauRgb(...args)[1] / ref[1]).toBeCloseTo(1, 2);
  });

  it('is zero with no dust field attached', () => {
    expect(foregroundDustTauRgb(SOL, TO_GC, 3122, 0)).toEqual([0, 0, 0]);
  });

  it('is zero when the camera is already inside the proxy', () => {
    expect(foregroundDustTauRgb(SOL, TO_GC, 1, 0.45)).toEqual([0, 0, 0]);
  });
});

// `foregroundSteps: 0` reproduces the pre-fix shader, which seeded τ at
// each mesh's own entry point. Comparing the two is the fix's blast
// radius.
describe('effect of seeding τ from the camera', () => {
  const withFix = (dir: Vec3) => sightlineColumn(SOL, dir);
  const withoutFix = (dir: Vec3) =>
    sightlineColumn(SOL, dir, { foregroundSteps: 0 });

  it('dims the Galactic-centre sightline by 0.083 mag', () => {
    const ratio = withFix(TO_GC) / withoutFix(TO_GC);
    expect(-2.5 * Math.log10(ratio)).toBeCloseTo(0.083, 3);
  });

  it('leaves sightlines that miss the bulge proxy bit-identical', () => {
    for (const dir of [galacticDirection(180, 0), galacticDirection(0, 90)]) {
      expect(withFix(dir)).toBe(withoutFix(dir));
    }
  });

  it('tapers with angle off the Galactic centre', () => {
    const offsets = [0, 10, 30].map(
      (d) => -2.5 * Math.log10(withFix(galacticDirection(d, 0)) / withoutFix(galacticDirection(d, 0))),
    );
    expect(offsets[0]).toBeCloseTo(0.083, 3);
    expect(offsets[1]).toBeCloseTo(0.056, 3);
    expect(offsets[2]).toBeCloseTo(0.017, 3);
  });
});

// Contradicts the intuition the bug report was written on: the bulge is
// NOT the dominant emitter toward the Galactic centre. The disc's
// exp(−(R−R₀)/hR) rise plus a 23 kpc path to its back face outweighs the
// bulge's density0 = 18 concentration over 10 kpc, which is why fixing
// the bulge's missing 0.315 τ_V moves the sightline by only 0.083 mag.
describe('per-component split toward the Galactic centre', () => {
  it('has the disc carrying roughly three quarters of the column', () => {
    const disc = relativeLuminance(componentColumnRgb(DISC_COMPONENT, SOL, TO_GC));
    const bulge = relativeLuminance(componentColumnRgb(BULGE_COMPONENT, SOL, TO_GC));
    expect(disc / (disc + bulge)).toBeCloseTo(0.77, 2);
  });
});

describe('quadrature of the in-volume march', () => {
  // Pre-existing, and left alone deliberately: STEPS is a visual + perf
  // decision, and H7 owns the calibration this biases. Pinned so it is a
  // known 1.7% under-count rather than a surprise.
  it('under-counts the GC column by 1.7% against a dense march', () => {
    const shipped = sightlineColumn(SOL, TO_GC);
    const ref = sightlineColumn(SOL, TO_GC, {
      steps: REFERENCE_STEPS,
      foregroundSteps: REFERENCE_STEPS,
    });
    expect(shipped / ref).toBeCloseTo(0.983, 3);
  });
});
