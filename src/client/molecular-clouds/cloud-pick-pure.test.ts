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
    expect(resolveCloudPick([], 0)).toBeNull();
  });

  it('returns the only hit, however far off-centre the cursor sits', () => {
    const winner = resolveCloudPick([taurus(149)], 0);
    expect(winner?.candidate.idx).toBe(0);
    expect(winner?.candidate.cameraDistancePc).toBe(140);
  });

  it('the raycast carries enclosure, so no pixel threshold can drop a hit', () => {
    // 900 px from the centre of a cloud that fills the screen. The ray
    // already proved the cursor is inside the silhouette, so the radius
    // reports size and never gates.
    const winner = resolveCloudPick([cloudPickCandidate(0, 900, 12, 4000)], 14);
    expect(winner?.candidate.idx).toBe(0);
    expect(winner?.enclosureRadiusPx).toBe(2000);
  });

  // The nested case: California sits inside Taurus on screen, so it is
  // the tighter answer everywhere the cursor is inside both — including
  // the places a centrality rule handed to Taurus, which is what made a
  // small cloud unreachable inside a large one.
  it('the smaller silhouette wins wherever the cursor is inside both', () => {
    expect(resolveCloudPick([taurus(130), california(40)], 0)?.candidate.idx).toBe(1);
    expect(resolveCloudPick([taurus(140), california(20)], 0)?.candidate.idx).toBe(1);
    expect(resolveCloudPick([taurus(30), california(44)], 0)?.candidate.idx).toBe(1);
  });

  it('the big complex keeps everywhere the small cloud does not reach', () => {
    expect(resolveCloudPick([taurus(30)], 0)?.candidate.idx).toBe(0);
  });

  it('centrality still separates two silhouettes of the same size', () => {
    const a = cloudPickCandidate(0, 60, 140, TAURUS_PX);
    const b = cloudPickCandidate(1, 20, 470, TAURUS_PX);
    expect(resolveCloudPick([a, b], 0)?.candidate.idx).toBe(1);
  });

  it('is independent of camera distance, in either candidate order', () => {
    // California sits 330 pc nearer the camera in the fixture.
    expect(resolveCloudPick([california(40), taurus(130)], 0)?.candidate.idx).toBe(1);
    expect(resolveCloudPick([taurus(130), california(40)], 0)?.candidate.idx).toBe(1);
  });
});
