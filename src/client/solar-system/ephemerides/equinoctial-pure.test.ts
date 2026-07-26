import { describe, it, expect } from 'vitest';

import { orbitalStateToCartesian } from '../../util/kepler-solver';
import {
  blendEquinoctialInto,
  equinoctialFromAngles,
  equinoctialToClassical,
  makeClassical,
  makeEquinoctial,
} from './equinoctial-pure';

const DEG = Math.PI / 180;

function positionFromAngles(
  aAu: number, e: number, iDeg: number, nodeDeg: number, longperiDeg: number, lambdaDeg: number,
): { x: number; y: number; z: number } {
  const eq = makeEquinoctial();
  const classical = makeClassical();
  const out = { x: 0, y: 0, z: 0 };
  equinoctialFromAngles(aAu, e, iDeg, nodeDeg, longperiDeg, lambdaDeg, eq);
  equinoctialToClassical(eq, classical);
  orbitalStateToCartesian(
    classical.aAu, classical.e, classical.incRad,
    classical.nodeRad, classical.argPeriRad, classical.mRad, out,
  );
  return out;
}

describe('equinoctial round trip', () => {
  it('recovers a/e/i and the angles for a well-conditioned orbit', () => {
    const eq = makeEquinoctial();
    const classical = makeClassical();
    equinoctialFromAngles(9.5415, 0.0555, 2.4942, 113.6400, 92.8614, 50.0757, eq);
    equinoctialToClassical(eq, classical);
    expect(classical.aAu).toBeCloseTo(9.5415, 12);
    expect(classical.e).toBeCloseTo(0.0555, 12);
    expect(classical.incRad / DEG).toBeCloseTo(2.4942, 10);
    expect(classical.nodeRad / DEG).toBeCloseTo(113.6400, 10);
    expect(classical.argPeriRad / DEG).toBeCloseTo(92.8614 - 113.6400, 10);
    expect(classical.mRad / DEG).toBeCloseTo(50.0757 - 92.8614, 10);
  });

  it('a negative tabulated inclination comes back canonical, same position', () => {
    // Standish's EM Bary row carries I = −0.00054346°. The round trip returns
    // (|i|, Ω + 180°, ω + 180°), which is the same rotation — and leaves ϖ and
    // λ untouched, because the two 180° shifts cancel in ϖ = Ω + ω.
    const flipped = positionFromAngles(1.0, 0.01673, -0.00054346, -5.1126, 102.9301, 100.4669);
    const canonical = positionFromAngles(1.0, 0.01673, 0.00054346, -5.1126 + 180, 102.9301, 100.4669);
    expect(flipped.x).toBeCloseTo(canonical.x, 12);
    expect(flipped.y).toBeCloseTo(canonical.y, 12);
    expect(flipped.z).toBeCloseTo(canonical.z, 12);
  });

  it('a node swinging 215° across a near-zero inclination barely moves the body', () => {
    // The Earth/Moon barycentre's real behaviour near J2000: Ω is reported at
    // 355.81° at one Horizons sample and 140.29° at the next, with ϖ
    // compensating. This is the singularity the equinoctial pair removes —
    // interpolating Ω and ω separately would put Earth across the Sun.
    const before = positionFromAngles(1.0, 0.016683, 0.003308, 355.8059, 355.8059 + 107.2339, 100);
    const after = positionFromAngles(1.0, 0.016702, 0.000103, 140.2922, 140.2922 + 322.6258, 100);
    expect(Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z))
      .toBeLessThan(2e-4);
  });
});

describe('blendEquinoctialInto', () => {
  const a = makeEquinoctial();
  const b = makeEquinoctial();
  const out = makeEquinoctial();
  equinoctialFromAngles(5.0, 0.05, 1.3, 100.0, 114.0, 34.0, a);
  equinoctialFromAngles(5.1, 0.06, 1.4, 101.0, 116.0, 35.0, b);

  it('returns each endpoint at weight 0 and 1', () => {
    blendEquinoctialInto(a, b, 0, out);
    expect(out).toEqual(a);
    blendEquinoctialInto(a, b, 1, out);
    expect(out.aAu).toBeCloseTo(b.aAu, 12);
    expect(out.lambdaDeg).toBeCloseTo(b.lambdaDeg, 12);
  });

  it('blends λ along the shortest arc across whole-turn offsets', () => {
    // The two sources count revolutions from different origins, so their raw
    // λ differ by turns even when they agree on where the planet is.
    const shifted = { ...b, lambdaDeg: b.lambdaDeg + 360 * 7 };
    blendEquinoctialInto(a, shifted, 0.5, out);
    expect(out.lambdaDeg).toBeCloseTo(34.5, 12);
  });

  it('writes correctly when out aliases an input', () => {
    const inPlace = { ...a };
    blendEquinoctialInto(inPlace, b, 0.25, inPlace);
    expect(inPlace.aAu).toBeCloseTo(5.025, 12);
    expect(inPlace.lambdaDeg).toBeCloseTo(34.25, 12);
  });
});
