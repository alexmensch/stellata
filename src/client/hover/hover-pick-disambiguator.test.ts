import { describe, expect, it } from 'vitest';
import {
  disambiguateHits,
  type HoverProviderHit,
} from './hover-pick-disambiguator';
import * as THREE from 'three';
import type { HoverHit, HoverProvider, HoverKind } from './hover-types';

// Stub provider whose `format` is never called by the disambiguator —
// the comparator only reads `hit`, not the provider. The fake exists so
// the returned winner carries a stable identity we can assert against.
const stubProvider = (kind: HoverKind): HoverProvider => ({
  kind,
  pick: () => null,
  format: () => ({ name: '', lines: [] }),
});

const hit = (
  idx: number,
  cameraDistancePc: number,
  enclosureRadiusPx: number,
  depthScore = 0.5,
): HoverHit => ({
  idx, cameraDistancePc, enclosureRadiusPx, depthScore,
  anchorLocal: new THREE.Vector3(idx, 0, 0),
});

// Representative on-screen half-extents, smallest first. The ordering
// between them is the whole rule; the exact values only have to keep
// that ordering.
const STAR_PX = 14;
const PLANET_PX = 30;
const LG_PX = 60;
const CLOUD_PX = 150;
const LOCAL_BUBBLE_PX = 1200;

const star = stubProvider('star');
const planet = stubProvider('planet');
const lg = stubProvider('local-group');
const shell = stubProvider('shell');
const cloud = stubProvider('cloud');

describe('hover-pick-disambiguator / disambiguateHits', () => {
  it('returns null for empty input', () => {
    expect(disambiguateHits([])).toBeNull();
  });

  it('returns the sole hit when only one provider hits', () => {
    const only: HoverProviderHit = { provider: star, hit: hit(7, 100, STAR_PX) };
    expect(disambiguateHits([only])).toBe(only);
  });

  // The four cases the rule exists for, walked from the inside out: a
  // star inside a cloud inside the Local Bubble, and one cloud inside
  // another. Camera distance is set to contradict the answer every time.
  it('a star inside a cloud silhouette wins, though the cloud is nearer', () => {
    const v519: HoverProviderHit = { provider: star, hit: hit(1, 2300, STAR_PX) };
    const carina: HoverProviderHit = { provider: cloud, hit: hit(4, 700, CLOUD_PX) };
    expect(disambiguateHits([carina, v519])).toBe(v519);
  });

  it('a cloud inside the Local Bubble wins, though the wall is nearer', () => {
    const carina: HoverProviderHit = { provider: cloud, hit: hit(4, 2300, CLOUD_PX) };
    const wall: HoverProviderHit = { provider: shell, hit: hit(0, 90, LOCAL_BUBBLE_PX) };
    expect(disambiguateHits([wall, carina])).toBe(carina);
  });

  it('the Local Bubble wins only when nothing tighter encloses the cursor', () => {
    const wall: HoverProviderHit = { provider: shell, hit: hit(0, 90, LOCAL_BUBBLE_PX) };
    expect(disambiguateHits([wall])).toBe(wall);
  });

  it('the enclosed cloud wins over the larger cloud enclosing it', () => {
    // Pipe behind Polaris: Polaris is nearer AND the cursor can sit
    // proportionally deeper inside it, so both of the keys this replaced
    // pick the wrong one.
    const pipe: HoverProviderHit = { provider: cloud, hit: hit(11, 145, 40, 0.95) };
    const polaris: HoverProviderHit = { provider: cloud, hit: hit(12, 100, 260, 0.05) };
    expect(disambiguateHits([polaris, pipe])).toBe(pipe);
  });

  it('a star inside an LG object wins, and that object beats the cloud around it', () => {
    const starHit: HoverProviderHit = { provider: star, hit: hit(1, 8, STAR_PX) };
    const lgHit: HoverProviderHit = { provider: lg, hit: hit(2, 800_000, LG_PX) };
    const cloudHit: HoverProviderHit = { provider: cloud, hit: hit(4, 140, CLOUD_PX) };
    expect(disambiguateHits([cloudHit, lgHit, starHit])).toBe(starHit);
    expect(disambiguateHits([cloudHit, lgHit])).toBe(lgHit);
  });

  // Viewed from outside, the Local Bubble wall is NEARER than every star
  // it encloses, which is how a click on a star used to reach the wall.
  // Size refuses it without knowing what a shell is.
  it('a star just off centre beats the shell wall in front of it', () => {
    const offCentreStar: HoverProviderHit = {
      provider: star,
      hit: hit(1, 240, STAR_PX, 0.93),
    };
    const nearWall: HoverProviderHit = {
      provider: shell,
      hit: hit(0, 90, LOCAL_BUBBLE_PX, 0.01),
    };
    expect(disambiguateHits([nearWall, offCentreStar])).toBe(offCentreStar);
  });

  it('camera distance never ranks, at any magnitude', () => {
    const touching: HoverProviderHit = { provider: shell, hit: hit(0, 1e-6, LOCAL_BUBBLE_PX) };
    const remoteStar: HoverProviderHit = { provider: star, hit: hit(1, 1e6, STAR_PX) };
    const remotePlanet: HoverProviderHit = { provider: planet, hit: hit(2, 1e6, PLANET_PX) };
    expect(disambiguateHits([touching, remoteStar])).toBe(remoteStar);
    expect(disambiguateHits([touching, remotePlanet])).toBe(remotePlanet);
    expect(disambiguateHits([remotePlanet, remoteStar])).toBe(remoteStar);
  });

  it('equal enclosures fall to the deeper hit', () => {
    const shallow: HoverProviderHit = { provider: star, hit: hit(1, 5, STAR_PX, 0.9) };
    const deep: HoverProviderHit = { provider: planet, hit: hit(2, 5000, STAR_PX, 0.1) };
    expect(disambiguateHits([shallow, deep])).toBe(deep);
  });

  // The gate lives here and nowhere else, so it answers for every kind at
  // once. Gating per layer is how a kind gets missed: a probe answered
  // the cursor through Sol's disc while four other kinds correctly
  // refused to, because the probe's pick was the one nobody had reached.
  describe('occlusion', () => {
    const hidesAt = (x: number) => ({
      occluders: { hides: (pos: THREE.Vector3) => pos.x === x },
      cameraPos: new THREE.Vector3(),
    });

    it('drops a hit a nearer solid body hides, whatever produced it', () => {
      for (const p of [star, planet, lg, cloud, shell]) {
        const hidden: HoverProviderHit = { provider: p, hit: hit(3, 1, STAR_PX) };
        expect(disambiguateHits([hidden], hidesAt(3))).toBeNull();
        expect(disambiguateHits([hidden], null)).toBe(hidden);
      }
    });

    it('lets the next surface answer once the hidden one is dropped', () => {
      // The probe is in front on size and hidden behind a body; the wall
      // the cursor also found is in open sky and takes the card.
      const probe: HoverProviderHit = { provider: star, hit: hit(3, 1, STAR_PX) };
      const wall: HoverProviderHit = { provider: shell, hit: hit(9, 90, LOCAL_BUBBLE_PX) };
      expect(disambiguateHits([probe, wall], null)).toBe(probe);
      expect(disambiguateHits([probe, wall], hidesAt(3))).toBe(wall);
    });
  });

  it('hits identical on both keys — first encountered wins (registration order)', () => {
    const a: HoverProviderHit = { provider: star, hit: hit(1, 5, STAR_PX, 0.4) };
    const b: HoverProviderHit = { provider: planet, hit: hit(2, 5, STAR_PX, 0.4) };
    expect(disambiguateHits([a, b])).toBe(a);
    expect(disambiguateHits([b, a])).toBe(b);
  });
});
