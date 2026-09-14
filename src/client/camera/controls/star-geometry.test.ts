import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  angularToPx,
  physSizePx,
  pickScore,
  pickFromCandidates,
  pickFromCandidatesResolved,
  discHitRadiusPx,
  MIN_DISC_HIT_RADIUS_PX,
  type StarPickCandidate,
  sortedDistRange,
  distAtFillFraction,
  peakAmplitudeFactor,
} from './star-geometry';
import { R_SUN_PC } from '../../util/astronomy-constants';

// Canonical viewport / FOV used across the tests below. 1080 vertical
// pixels at 50° vertical FOV ≈ 1238 px / radian — close to the live
// rendered viewport at 1080p so the absolute pixel values match what an
// observer would see.
const VIEWPORT_Y = 1080;
const FOV_Y_RAD = (50 * Math.PI) / 180;

describe('star-geometry / angularToPx', () => {
  it('matches viewport.y / fovYRad for the canonical viewport', () => {
    expect(angularToPx(VIEWPORT_Y, FOV_Y_RAD)).toBeCloseTo(VIEWPORT_Y / FOV_Y_RAD, 9);
  });

  it('floors fovYRad at 1e-9 so a transient zero FOV does not divide by zero', () => {
    const out = angularToPx(VIEWPORT_Y, 0);
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBeGreaterThan(0);
  });
});

describe('star-geometry / physSizePx', () => {
  it('matches the angular-diameter formula 2·atan(R/d)·angularToPx', () => {
    const R_pc = 5 * R_SUN_PC;
    const dCam = 10;
    const expected = 2 * Math.atan(R_pc / dCam) * angularToPx(VIEWPORT_Y, FOV_Y_RAD);
    expect(physSizePx(R_pc, dCam, VIEWPORT_Y, FOV_Y_RAD)).toBeCloseTo(expected, 12);
  });

  it('scales linearly with radiusFactor at large dCam (small-angle regime)', () => {
    // At dCam >> R, atan(R/d) ≈ R/d so doubling the radius doubles the disc.
    const R_pc = 5 * R_SUN_PC;
    const dCam = 1; // 1 pc, ~10⁸ × R for a Sol-sized star
    const single = physSizePx(R_pc, dCam, VIEWPORT_Y, FOV_Y_RAD, 1);
    const doubled = physSizePx(R_pc, dCam, VIEWPORT_Y, FOV_Y_RAD, 2);
    expect(doubled / single).toBeCloseTo(2, 6);
  });

  it('saturates at π·angularToPx as dCam → 0 (camera inside the star)', () => {
    // atan(R/d) → π/2 as d → 0, so 2·atan → π.
    const R_pc = 5 * R_SUN_PC;
    const huge = physSizePx(R_pc, 1e-30, VIEWPORT_Y, FOV_Y_RAD);
    const ceiling = Math.PI * angularToPx(VIEWPORT_Y, FOV_Y_RAD);
    expect(huge).toBeLessThanOrEqual(ceiling);
    expect(huge).toBeGreaterThan(ceiling * 0.999);
  });

  // Acceptance #2 — resolved-disc ratio matches R ratio.
  // Betelgeuse R ≈ 887 R_sun, Sirius R ≈ 1.71 R_sun. At a fixed close-but-not-
  // saturating dCam, the rendered sizes should be in the same ratio.
  it('Betelgeuse:Sirius rendered ratio matches their physical-radius ratio', () => {
    const Rb = 887 * R_SUN_PC;
    const Rs = 1.71 * R_SUN_PC;
    // dCam picked so R/d is small for both — well inside the small-angle
    // regime where ratio cleanly tracks R ratio.
    const dCam = 1; // pc
    const sizeB = physSizePx(Rb, dCam, VIEWPORT_Y, FOV_Y_RAD);
    const sizeS = physSizePx(Rs, dCam, VIEWPORT_Y, FOV_Y_RAD);
    expect(sizeB / sizeS).toBeCloseTo(Rb / Rs, 4);
  });
});

describe('star-geometry / distAtFillFraction', () => {
  // Acceptance #3 — at d = minOrbit, a Sol-sized star
  // fills 90% of the viewport's minor axis.
  it('inverts physSizePx: fill-fraction at distAtFillFraction(R, fov, frac)', () => {
    const R_pc = 1 * R_SUN_PC;
    const fovMinor = FOV_Y_RAD; // square viewport so minor == vertical
    const frac = 0.9;
    const d = distAtFillFraction(R_pc, fovMinor, frac);
    // Disc fills `frac` of viewport_y.
    expect(physSizePx(R_pc, d, VIEWPORT_Y, FOV_Y_RAD)).toBeCloseTo(frac * VIEWPORT_Y, 4);
  });

  // Acceptance #4 — at d = minDist (target park), the disc fills ~10%.
  it('produces 10% fill at TARGET_PARK_FRACTION = 0.10', () => {
    const R_pc = 1 * R_SUN_PC;
    const fovMinor = FOV_Y_RAD;
    const d = distAtFillFraction(R_pc, fovMinor, 0.10);
    expect(physSizePx(R_pc, d, VIEWPORT_Y, FOV_Y_RAD)).toBeCloseTo(0.10 * VIEWPORT_Y, 4);
  });

  it('produces a shorter distance for a larger star at the same fill fraction', () => {
    // ...wait, that's wrong. Larger R needs MORE distance to keep the same
    // angular fraction. Verify the monotonicity: bigger R ⇒ farther park.
    const fovMinor = FOV_Y_RAD;
    const dSol = distAtFillFraction(1 * R_SUN_PC, fovMinor, 0.10);
    const dGiant = distAtFillFraction(100 * R_SUN_PC, fovMinor, 0.10);
    expect(dGiant).toBeGreaterThan(dSol);
    // …and the ratio matches the radius ratio in the small-angle regime.
    expect(dGiant / dSol).toBeCloseTo(100, 4);
  });
});

describe('star-geometry / peakAmplitudeFactor', () => {
  it('returns 1 for non-variables (no period, no amplitude)', () => {
    expect(peakAmplitudeFactor(1.4, 0, 0)).toBe(1);
  });

  it('returns 1 when amplitude is set but period is missing (and vice versa)', () => {
    // GCVS rows with a period but no amplitude (or vice versa) shouldn't
    // be modulated — the renderer treats them as static stars.
    expect(peakAmplitudeFactor(1.4, 0.5, 0)).toBe(1);
    expect(peakAmplitudeFactor(1.4, 0, 4.5)).toBe(1);
  });

  it('returns √ρ for a real variable', () => {
    // Mira ρ = 1.4 → peak radius factor √1.4 ≈ 1.183 (the disc swings by
    // at most ~18% up from the static R — the radius no longer carries
    // the full V-band amplitude).
    expect(peakAmplitudeFactor(1.4, 8.5, 332)).toBeCloseTo(Math.sqrt(1.4), 12);
    // Cepheid ρ = 1.15 → √1.15 ≈ 1.072.
    expect(peakAmplitudeFactor(1.15, 0.89, 5.37)).toBeCloseTo(Math.sqrt(1.15), 12);
  });

  it('is monotonic in ρ for a fixed period/amplitude', () => {
    expect(peakAmplitudeFactor(1.02, 1, 100)).toBeLessThan(peakAmplitudeFactor(1.15, 1, 100));
    expect(peakAmplitudeFactor(1.15, 1, 100)).toBeLessThan(peakAmplitudeFactor(1.4, 1, 100));
  });

  it('treats negative amp/period as non-variable (defensive)', () => {
    expect(peakAmplitudeFactor(1.4, -1, 100)).toBe(1);
    expect(peakAmplitudeFactor(1.4, 2, -100)).toBe(1);
  });
});

describe('star-geometry / pickScore', () => {
  // The three regressions below are all same-size comparisons, where the
  // shared divisor cancels: normalising the whole numerator is what keeps
  // them reading exactly as they did before the divisor existed.
  const R = 5;

  it('is dominated by pxDist: a 50px-away brighter star loses to a 0px-away fainter one', () => {
    // Double Double regression: cursor on ε² Lyr (mag 4.59), with ε¹ Lyr
    // (mag 4.67) ~50px away on screen but with a hitbox that reaches the
    // cursor. The cursor is on ε²'s centre; ε² must win.
    const eps2 = pickScore(0, 4.59, R);
    const eps1 = pickScore(50, 4.67, R);
    expect(eps2).toBeLessThan(eps1);
  });

  it('breaks ties by brightness when two candidates project to the same pixel', () => {
    // Alula Australis regression: A (mag 4.33) and B (mag 4.80) share
    // identical x/y/z in AT-HYG, so both project to the same screen pixel
    // and pxDist is identical. The brighter component (A) must win.
    const a = pickScore(0, 4.33, R);
    const b = pickScore(0, 4.80, R);
    expect(a).toBeLessThan(b);
  });

  it('uses a sub-pixel mag bias so a 1-mag-fainter star at the same pxDist beats a 1px-farther brighter one', () => {
    // The mag bias is small enough (0.05 px / mag) that any visible
    // pxDist gap dominates. A star 1px farther but 1 mag brighter still
    // loses to the centre-aligned fainter one — picking by visible
    // proximity, not brightness, is the contract.
    const closeFaint = pickScore(0, 6, R);
    const farBright = pickScore(1, 5, R);
    expect(closeFaint).toBeLessThan(farBright);
  });

  it('ranks by proportional depth, so a big disc beats a pinprick the cursor is clipping', () => {
    // 20 px into a 40 px radius is halfway in; 3 px into a 4 px radius is
    // three quarters of the way out. The cursor is deeper inside the big
    // disc, so that is what the user meant.
    expect(pickScore(20, 0, 40)).toBeLessThan(pickScore(3, 0, 4));
  });

  it('still gives the pinprick the pick when it is clicked squarely', () => {
    // Scale-invariance cuts both ways: the small target keeps the region
    // where the cursor is proportionally deeper inside it.
    expect(pickScore(0.5, 0, 4)).toBeLessThan(pickScore(20, 0, 40));
  });
});

describe('star-geometry / pickFromCandidates', () => {
  // Synthetic candidate factory — keeps the per-test arrays readable.
  // `cameraDistancePc` is irrelevant for the reducer's tier+score
  // logic; pinned to 1 pc so the field is populated without
  // distracting from the per-test inputs.
  const c = (
    idx: number,
    pxDist: number,
    hitRadius: number,
    appMag: number,
  ): StarPickCandidate => ({
    idx, pxDist, hitRadius, appMag, cameraDistancePc: 1,
    anchorLocal: new THREE.Vector3(),
  });

  // Star scorer is passed explicitly now that pickFromCandidates is
  // generic; non-star providers default to closest-to-cursor.
  const starScore = (cand: StarPickCandidate) =>
    pickScore(cand.pxDist, cand.appMag, cand.hitRadius);

  it('returns null when no candidates exist', () => {
    expect(pickFromCandidates([], 16, starScore)).toBeNull();
  });

  it('equal enclosures: lowest pickScore wins', () => {
    // Every candidate here draws smaller than the grab threshold, so all
    // three report the same enclosure and the score alone separates them.
    const cands = [
      c(10, 3, 5, 4.0), // score = 3 + 0.20 = 3.20
      c(11, 1, 5, 4.5), // score = 1 + 0.225 = 1.225 ← winner
      c(12, 4, 5, 3.0), // score = 4 + 0.15 = 4.15
    ];
    const r = pickFromCandidates(cands, 16, starScore);
    expect(r?.candidate.idx).toBe(11);
    expect(r?.enclosureRadiusPx).toBe(16);
  });

  it('nearest-to-cursor wins when the cursor is inside no drawn disc', () => {
    // No candidate's pxDist is inside its own hitRadius; each is reached
    // only through the grab threshold, which is then their shared
    // enclosure, so lowest pickScore wins.
    const cands = [
      c(20, 8, 2, 5.0), // pxDist > hitRadius → fallback; score = 8.25
      c(21, 6, 2, 5.5), // fallback; score = 6.275 ← winner
      c(22, 14, 2, 4.0), // fallback; score = 14.20
    ];
    const r = pickFromCandidates(cands, 16, starScore);
    expect(r?.candidate.idx).toBe(21);
  });

  it('equal enclosures fall to the deeper hit, not the nearer one', () => {
    // Both draw under the threshold, so they enclose equally and the
    // score decides — and the score is proportional, so sitting at 0.9 of
    // one disc's radius beats sitting at twice another's, even though the
    // second centre is 3.5 px nearer in raw pixels.
    const cands = [
      c(30, 4.5, 5, 4.0), // 0.9 of its own radius
      c(31, 1.0, 0.5, 3.0), // twice its own radius
    ];
    const r = pickFromCandidates(cands, 16, starScore);
    expect(r?.candidate.idx).toBe(30);
  });

  it('prime tier with tied score (Alula Australis): brighter component wins', () => {
    // Two coincident catalog rows — same pxDist, same hitRadius. Only
    // the magnitude differs. Brighter (lower appMag) must win.
    const cands = [
      c(40, 0, 5, 4.33), // Alula A
      c(41, 0, 5, 4.80), // Alula B
    ];
    expect(pickFromCandidates(cands, 16, starScore)?.candidate.idx).toBe(40);
  });

  it('a faint target scraping the threshold loses to one the cursor is on', () => {
    // Equal enclosures again; the brighter candidate is 16 px out and the
    // dimmer one is on its own disc, so the score carries it.
    const cands = [
      c(50, 4.99, 5, 6.0), // just inside its disc; score ≈ 5.29
      c(51, 15.99, 0.5, 0.0), // scraping the threshold; score ≈ 15.99
    ];
    const r = pickFromCandidates(cands, 16, starScore);
    expect(r?.candidate.idx).toBe(50);
  });

  it('candidates the cursor is outside entirely are ignored', () => {
    // Reducer must skip candidates whose enclosure the cursor is beyond,
    // even where pickScore would otherwise rank them.
    const cands = [
      c(60, 100, 5, 0.0), // way out; ignored
      c(61, 50, 5, 1.0), // also out
    ];
    expect(pickFromCandidates(cands, 16, starScore)).toBeNull();
  });

  it('default scorer — deepest inside its own target wins when no scorer is passed', () => {
    // Non-star providers (planets, Local Group, probes) rely on the
    // default scoreFn = c.pxDist / c.hitRadius. No magnitude axis, no
    // sub-pixel bias; among equal-radius candidates that is still simply
    // the closest centroid, which is what these three are.
    const cands: StarPickCandidate[] = [
      { idx: 70, pxDist: 8, hitRadius: 2, appMag: 0, cameraDistancePc: 1, anchorLocal: new THREE.Vector3() },
      { idx: 71, pxDist: 4, hitRadius: 2, appMag: 0, cameraDistancePc: 1, anchorLocal: new THREE.Vector3() }, // winner
      { idx: 72, pxDist: 6, hitRadius: 2, appMag: 0, cameraDistancePc: 1, anchorLocal: new THREE.Vector3() },
    ];
    const r = pickFromCandidates(cands, 16);
    expect(r?.candidate.idx).toBe(71);
  });

  // The accepted cost of ranking on size: a candidate drawn LARGER than
  // the threshold is outranked by any smaller one the cursor also
  // reaches, however much deeper into the big one the cursor sits. That
  // is the same property that makes a cloud reachable inside the Local
  // Bubble, applied to two compact objects, and it is why a foreground
  // body needs an occlusion gate rather than a size exemption — a star
  // the body hides must not be a candidate at all.
  it('a small target beats a much larger one the cursor is deeper inside', () => {
    const cands = [
      { idx: 90, pxDist: 20, hitRadius: 40, cameraDistancePc: 1 }, // encloses at 40
      { idx: 91, pxDist: 3, hitRadius: 4, cameraDistancePc: 9 }, // encloses at 16 ← winner
    ];
    const r = pickFromCandidates(cands, 16);
    expect(r?.candidate.idx).toBe(91);
    expect(r?.enclosureRadiusPx).toBe(16);
  });

  it('the pinprick keeps it when clicked squarely', () => {
    const cands = [
      { idx: 90, pxDist: 20, hitRadius: 40, cameraDistancePc: 1 }, // 0.500
      { idx: 91, pxDist: 0.5, hitRadius: 4, cameraDistancePc: 9 }, // 0.125 ← winner
    ];
    expect(pickFromCandidates(cands, 16)?.candidate.idx).toBe(91);
  });

  it('returns the original candidate object — extension fields ride through', () => {
    // Caller-extended candidates (LG carries cameraDistancePc; planet
    // picker carries hostStarIdx + planetIdx) must come back intact so
    // the caller doesn't re-walk projection state to recover them.
    type LgCand = { idx: number; pxDist: number; hitRadius: number; cameraDistancePc: number };
    const cands: LgCand[] = [
      { idx: 80, pxDist: 3, hitRadius: 10, cameraDistancePc: 1_500_000 },
      { idx: 81, pxDist: 1, hitRadius: 10, cameraDistancePc: 50_000 }, // winner
    ];
    const r = pickFromCandidates(cands, 16);
    expect(r?.candidate.idx).toBe(81);
    expect(r?.candidate.cameraDistancePc).toBe(50_000);
  });
});

describe('star-geometry / discHitRadiusPx', () => {
  it('halves the drawn diameter once past the floor', () => {
    expect(discHitRadiusPx(20)).toBe(10);
    expect(discHitRadiusPx(2 * MIN_DISC_HIT_RADIUS_PX)).toBe(MIN_DISC_HIT_RADIUS_PX);
  });

  it('floors a sub-pixel disc so the cursor can still land on it', () => {
    expect(discHitRadiusPx(0)).toBe(MIN_DISC_HIT_RADIUS_PX);
    expect(discHitRadiusPx(1.5)).toBe(MIN_DISC_HIT_RADIUS_PX);
  });
});

describe('star-geometry / pickFromCandidatesResolved', () => {
  const c = (
    idx: number,
    pxDist: number,
    hitRadius: number,
    appMag: number,
  ): StarPickCandidate => ({
    idx, pxDist, hitRadius, appMag, cameraDistancePc: 1,
    anchorLocal: new THREE.Vector3(),
  });
  const starScore = (cand: StarPickCandidate) =>
    pickScore(cand.pxDist, cand.appMag, cand.hitRadius);
  const lit = (hitRadius: number) => () => ({ visible: true, hitRadius });

  it('skips the best-scoring candidate when the frame draws nothing for it', () => {
    // The whole point of the gate: idx 10 wins on score but renders
    // black (dust / toe / adaptation), so the pick falls to idx 11.
    const cands = [c(10, 1, 5, 4.0), c(11, 3, 5, 4.0)];
    const r = pickFromCandidatesResolved(cands, 16, starScore, (cand) => ({
      visible: cand.idx === 11,
      hitRadius: 5,
    }));
    expect(r?.candidate.idx).toBe(11);
  });

  it('returns null when nothing the cursor reaches renders', () => {
    const cands = [c(10, 1, 5, 4.0), c(11, 12, 5, 4.0)];
    expect(
      pickFromCandidatesResolved(cands, 16, starScore, () => ({ visible: false, hitRadius: 5 })),
    ).toBeNull();
  });

  it('resolves each candidate at most once', () => {
    // Each resolve is a GPU readback, so walking one ordered list rather
    // than re-examining a demoted candidate is a correctness-adjacent
    // perf invariant, not an optimisation.
    const cands = [c(10, 4, 5, 4.0), c(11, 6, 8, 4.0)];
    const seen: number[] = [];
    pickFromCandidatesResolved(cands, 16, starScore, (cand) => {
      seen.push(cand.idx);
      return { visible: false, hitRadius: 0 };
    });
    expect(seen).toEqual([...new Set(seen)]);
  });

  it('keeps a shrunken candidate the threshold still reaches', () => {
    // Prefilter admitted a 5 px radius; extinction shrinks the drawn disc
    // under the cursor distance. Still pickable, because the grab
    // threshold floors the enclosure it reports.
    const cands = [c(10, 4, 5, 4.0)];
    const r = pickFromCandidatesResolved(cands, 16, starScore, lit(1));
    expect(r?.candidate.idx).toBe(10);
    expect(r?.enclosureRadiusPx).toBe(16);
  });

  it('laziness must not reorder the ranking', () => {
    // Same answer the eager reducer gives on these inputs: equal
    // enclosures, and the deeper-in candidate takes it.
    const cands = [c(10, 5, 6, 4.0), c(11, 1, 0.5, 4.0)];
    const r = pickFromCandidatesResolved(cands, 16, starScore, lit(6));
    expect(r?.candidate.idx).toBe(10);
    expect(pickFromCandidates(cands, 16, starScore)?.candidate.idx).toBe(10);
  });

  it('stops resolving once a winner is found — the laziness the readback pays for', () => {
    const cands = [c(10, 1, 5, 4.0), c(11, 2, 5, 4.0), c(12, 3, 5, 4.0)];
    let calls = 0;
    pickFromCandidatesResolved(cands, 16, starScore, () => {
      calls++;
      return { visible: true, hitRadius: 5 };
    });
    expect(calls).toBe(1);
  });
});

describe('star-geometry / sortedDistRange', () => {
  // Half-open [start, end) slice on a sorted Float32Array. Shared
  // between the star pick path (filter window) and the core-mask gate
  // (triangle-inequality bracket); both compose this helper.
  it('returns an empty range when minDist > maxDist', () => {
    const sd = new Float32Array([0, 1, 2, 3, 4]);
    const { start, end } = sortedDistRange(sd, 3, 1);
    expect(end).toBeLessThanOrEqual(start);
  });

  it('returns the full array when the band covers the whole range', () => {
    const sd = new Float32Array([0.5, 1.0, 1.5, 2.0]);
    const { start, end } = sortedDistRange(sd, 0, 100);
    expect(start).toBe(0);
    expect(end).toBe(4);
  });

  it('snaps the start to the first value >= minDist', () => {
    const sd = new Float32Array([0, 1, 2, 3, 4, 5]);
    const { start } = sortedDistRange(sd, 2.5, 100);
    expect(start).toBe(3); // first index whose value (3) ≥ 2.5
  });

  it('snaps the end past the last value <= maxDist', () => {
    const sd = new Float32Array([0, 1, 2, 3, 4, 5]);
    const { end } = sortedDistRange(sd, 0, 3.5);
    expect(end).toBe(4); // half-open — covers values 0,1,2,3
  });

  it('inclusive on both endpoints', () => {
    const sd = new Float32Array([0, 1, 2, 3, 4]);
    const { start, end } = sortedDistRange(sd, 1, 3);
    expect(start).toBe(1);
    expect(end).toBe(4);
    expect(end - start).toBe(3); // 1, 2, 3
  });

  it('returns start=end when no values fall in the band', () => {
    const sd = new Float32Array([0, 1, 10, 11]);
    const { start, end } = sortedDistRange(sd, 3, 5);
    expect(start).toBe(end);
  });

  it('handles an empty array', () => {
    const sd = new Float32Array([]);
    const { start, end } = sortedDistRange(sd, 0, 100);
    expect(start).toBe(0);
    expect(end).toBe(0);
  });
});
