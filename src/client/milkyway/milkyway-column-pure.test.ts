import { describe, expect, it } from 'vitest';
import {
  BULGE_COMPONENT,
  DEFAULT_EXTINCTION_STRENGTH,
  DISC_COMPONENT,
  SOL_GALACTOCENTRIC_PC,
  type Vec3,
  componentLuminanceShare,
  foregroundDustTauRgb,
  galacticDirection,
  meshSpanPc,
  sightlineColumn,
} from './milkyway-column-pure';

const SOL = SOL_GALACTOCENTRIC_PC;
const TO_GC = galacticDirection(0, 0);
const REFERENCE_STEPS = 4096;
const K = DEFAULT_EXTINCTION_STRENGTH;

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
  it('carries 4.64 τ_V over the Sol→bulge-boundary sightline', () => {
    const tau = foregroundDustTauRgb(SOL, TO_GC, 3122, K);
    expect(tau[1]).toBeCloseTo(4.6407, 4);
    // CCM reddening: blue extincts hardest, so the column warms as well
    // as dims what lies behind it.
    expect(tau[0]).toBeLessThan(tau[1]);
    expect(tau[2]).toBeGreaterThan(tau[1]);
  });

  // Linear-midpoint quadrature is the choice this pins: the integrand
  // rises monotonically toward the boundary, so the in-volume march's log
  // distribution would spend its samples at the wrong end.
  it('converges to a dense reference march in the plane', () => {
    const ref = foregroundDustTauRgb(SOL, TO_GC, 3122, K, REFERENCE_STEPS);
    const shipped = foregroundDustTauRgb(SOL, TO_GC, 3122, K);
    expect(shipped[1] / ref[1]).toBeCloseTo(1, 3);
  });

  it('converges on a grazing slab crossing outside the proxy', () => {
    const span = meshSpanPc(
      GRAZING_ORIGIN,
      GRAZING_DIR,
      BULGE_COMPONENT.meshScalePc,
    );
    expect(span).not.toBeNull();
    const args = [GRAZING_ORIGIN, GRAZING_DIR, span!.sNear, K] as const;
    const ref = foregroundDustTauRgb(...args, REFERENCE_STEPS);
    // Non-trivial column, or the convergence check below proves nothing.
    expect(ref[1]).toBeGreaterThan(0.05);
    expect(foregroundDustTauRgb(...args)[1] / ref[1]).toBeCloseTo(1, 2);
  });

  it('is zero with no dust field attached', () => {
    expect(foregroundDustTauRgb(SOL, TO_GC, 3122, 0)).toEqual([0, 0, 0]);
  });

  it('is zero when the camera is already inside the proxy', () => {
    expect(foregroundDustTauRgb(SOL, TO_GC, 1, K)).toEqual([0, 0, 0]);
  });
});

// `foregroundSteps: 0` reproduces the pre-fix shader, which seeded τ at
// each mesh's own entry point. Comparing the two is the fix's blast
// radius.
describe('effect of seeding τ from the camera', () => {
  const withFix = (dir: Vec3) => sightlineColumn(SOL, dir);
  const withoutFix = (dir: Vec3) =>
    sightlineColumn(SOL, dir, { foregroundSteps: 0 });

  it('dims the Galactic-centre sightline by 0.013 mag', () => {
    const ratio = withFix(TO_GC) / withoutFix(TO_GC);
    expect(-2.5 * Math.log10(ratio)).toBeCloseTo(0.0132, 3);
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
    expect(offsets[0]).toBeCloseTo(0.0132, 3);
    expect(offsets[1]).toBeCloseTo(0.0130, 3);
    expect(offsets[2]).toBeCloseTo(0.0113, 3);
  });
});

// At a realistic extinction rate the bulge is essentially invisible from
// Sol in V — it sits behind 4.6 τ_V before its own march even begins, and
// the disc's exp(−(R−R₀)/hR) rise over a 23 kpc path is unobscured for its
// nearest and brightest part. Every photon the band shows toward the
// centre is foreground disc, which is what the real sky looks like.
describe('per-component split toward the Galactic centre', () => {
  it('has the disc carrying essentially the whole column', () => {
    expect(componentLuminanceShare(DISC_COMPONENT, SOL, TO_GC)).toBeCloseTo(
      0.99980,
      5,
    );
  });
});

describe('quadrature of the in-volume march', () => {
  // Left alone deliberately: STEPS is a visual + perf decision, and it
  // cannot bias the calibration at all — ρ₀ is solved as a volume
  // integral, so no march feeds it.
  it('under-counts the GC column by 1.6% against a dense march', () => {
    const shipped = sightlineColumn(SOL, TO_GC);
    const ref = sightlineColumn(SOL, TO_GC, {
      steps: REFERENCE_STEPS,
      foregroundSteps: REFERENCE_STEPS,
    });
    expect(shipped / ref).toBeCloseTo(0.9841, 3);
  });
});
