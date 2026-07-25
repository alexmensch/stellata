import { describe, it, expect } from 'vitest';
import { cloudPickCandidate, cloudPickScore, resolveCloudPick } from './cloud-pick-pure';

// The two overlapping complexes the rule was designed against: Taurus as
// a 300 px-wide silhouette with the much smaller California nebula
// nested inside it on screen.
const TAURUS_PX = 300;
const CALIFORNIA_PX = 90;

function taurus(pxFromCentre: number) {
  return cloudPickCandidate(0, pxFromCentre, 140, TAURUS_PX);
}
function california(pxFromCentre: number) {
  return cloudPickCandidate(1, pxFromCentre, 470, CALIFORNIA_PX);
}

describe('cloudPickScore', () => {
  it('is the cursor offset as a fraction of the cloud own projected radius', () => {
    expect(cloudPickScore(0, TAURUS_PX)).toBe(0);
    expect(cloudPickScore(150, TAURUS_PX)).toBe(1);
    expect(cloudPickScore(75, TAURUS_PX)).toBe(0.5);
    // Scale-invariant: the same fraction of a 3.3× smaller silhouette.
    expect(cloudPickScore(22.5, CALIFORNIA_PX)).toBe(0.5);
  });

  it('stays finite for a silhouette collapsed below the radius floor', () => {
    const score = cloudPickScore(0.2, 0);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

describe('resolveCloudPick', () => {
  it('returns null for no hits', () => {
    expect(resolveCloudPick([])).toBeNull();
  });

  it('returns the only hit, however far off-centre the cursor sits', () => {
    const winner = resolveCloudPick([taurus(149)]);
    expect(winner?.candidate.idx).toBe(0);
    expect(winner?.candidate.cameraDistancePc).toBe(140);
  });

  it('every enclosing hit is prime tier — no pixel threshold can drop it', () => {
    // 900 px from the centre of a cloud that fills the screen: a
    // real-radius hitRadius would demote this to the fallback tier and
    // the reducer threshold (0) would then discard it entirely.
    const winner = resolveCloudPick([cloudPickCandidate(0, 900, 12, 4000)]);
    expect(winner?.candidate.idx).toBe(0);
    expect(winner?.tier).toBe('prime');
  });

  it('picks the big complex when the cursor is proportionally deeper inside it', () => {
    // 130/150 = 0.87 vs 40/45 = 0.89 — Taurus wins even though the
    // cursor is 3× closer to California centre in raw pixels, which is
    // what a nearest-projected-centre rule would have picked.
    expect(resolveCloudPick([taurus(130), california(40)])?.candidate.idx).toBe(0);
  });

  it('picks the small cloud when the cursor is central in it and at the big edge', () => {
    // 140/150 = 0.93 vs 20/45 = 0.44.
    expect(resolveCloudPick([taurus(140), california(20)])?.candidate.idx).toBe(1);
  });

  it('picks the big complex when the cursor is near the small cloud edge', () => {
    // 30/150 = 0.20 vs 44/45 = 0.98.
    expect(resolveCloudPick([taurus(30), california(44)])?.candidate.idx).toBe(0);
  });

  it('is independent of camera distance — the foreground cloud does not win by depth', () => {
    // California sits 330 pc nearer the camera in the fixture; ordering
    // the candidates either way resolves to the same winner.
    expect(resolveCloudPick([california(40), taurus(130)])?.candidate.idx).toBe(0);
    expect(resolveCloudPick([taurus(130), california(40)])?.candidate.idx).toBe(0);
  });
});
