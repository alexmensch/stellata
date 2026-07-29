import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { unitVectorFromRaDec } from '../util/equatorial-basis';
import { GALACTIC_NORTH_POLE_ICRS } from './galactic-coords';
import { nextCoordSphereFrame, type CoordSphereFrame } from './coord-sphere';
import {
  EQUATORIAL_SPHERE_SPEC,
  GALACTIC_SPHERE_SPEC,
  equatorialDirToIcrs,
  fmtDecDeg,
  fmtLatDeg,
  fmtLonDeg,
  fmtRaHours,
} from './coord-sphere-frames';

const DEG = Math.PI / 180;

describe('equatorialDirToIcrs', () => {
  it('is the identity frame — α 0h δ 0° is ICRS +x, the pole is +z', () => {
    const v = new THREE.Vector3();
    equatorialDirToIcrs(0, 0, v);
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.y).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(0, 12);
    equatorialDirToIcrs(0, Math.PI / 2, v);
    expect(v.z).toBeCloseTo(1, 12);
  });

  it('agrees with the shared unitVectorFromRaDec across the sphere', () => {
    const v = new THREE.Vector3();
    for (const raDeg of [0, 37, 120, 271, 359]) {
      for (const decDeg of [-89, -45, 0, 23.5, 88]) {
        equatorialDirToIcrs(raDeg * DEG, decDeg * DEG, v);
        const u = unitVectorFromRaDec(raDeg, decDeg);
        expect(v.x).toBeCloseTo(u.x, 12);
        expect(v.y).toBeCloseTo(u.y, 12);
        expect(v.z).toBeCloseTo(u.z, 12);
      }
    }
  });

  // The whole point of a second sphere: the two equators are ~63° apart, so a
  // frame mix-up would show up as an equator lying on the galactic plane.
  it('puts its pole ~63° off the galactic pole', () => {
    const ncp = new THREE.Vector3();
    equatorialDirToIcrs(0, Math.PI / 2, ncp);
    expect(Math.acos(ncp.dot(GALACTIC_NORTH_POLE_ICRS)) / DEG).toBeCloseTo(62.87, 1);
  });
});

describe('sphere specs', () => {
  it('spaces equatorial meridians on the hour circles', () => {
    expect(EQUATORIAL_SPHERE_SPEC.meridianCount).toBe(24);
    expect(360 / EQUATORIAL_SPHERE_SPEC.meridianCount).toBe(15);
  });

  it('keeps the galactic sphere on 10° meridians', () => {
    expect(GALACTIC_SPHERE_SPEC.meridianCount).toBe(36);
  });

  it('labels every equatorial meridian as a whole hour', () => {
    const n = EQUATORIAL_SPHERE_SPEC.meridianCount;
    const labels = Array.from({ length: n }, (_, i) =>
      EQUATORIAL_SPHERE_SPEC.lonLabel((i * 360) / n));
    expect(labels[0]).toBe('0h');
    expect(labels[1]).toBe('1h');
    expect(labels[n - 1]).toBe('23h');
    expect(new Set(labels).size).toBe(n);
  });

  it('pools the two label sets under different SVG groups', () => {
    expect(GALACTIC_SPHERE_SPEC.labelGroupId).not.toBe(EQUATORIAL_SPHERE_SPEC.labelGroupId);
  });
});

describe('label formatters', () => {
  it('wraps galactic longitude into [0, 360)', () => {
    expect(fmtLonDeg(0)).toBe('0°');
    expect(fmtLonDeg(350)).toBe('350°');
    expect(fmtLonDeg(360)).toBe('0°');
    expect(fmtLonDeg(-10)).toBe('350°');
  });

  it('keeps galactic latitude signed and whole-degree', () => {
    expect(fmtLatDeg(-80)).toBe('-80°');
    expect(fmtLatDeg(80)).toBe('80°');
    expect(fmtLatDeg(0)).toBe('0°');
    expect(fmtLatDeg(29.6)).toBe('30°');
  });

  it('wraps right ascension into [0h, 24h)', () => {
    expect(fmtRaHours(0)).toBe('0h');
    expect(fmtRaHours(180)).toBe('12h');
    expect(fmtRaHours(345)).toBe('23h');
    expect(fmtRaHours(360)).toBe('0h');
    expect(fmtRaHours(-15)).toBe('23h');
  });

  it('signs declination explicitly so it never reads as a longitude', () => {
    expect(fmtDecDeg(80)).toBe('+80°');
    expect(fmtDecDeg(-80)).toBe('-80°');
    expect(fmtDecDeg(0)).toBe('0°');
  });
});

describe('nextCoordSphereFrame', () => {
  const cycle = (start: CoordSphereFrame, reachable: boolean, steps: number) => {
    const out: CoordSphereFrame[] = [];
    let cur = start;
    for (let i = 0; i < steps; i++) {
      cur = nextCoordSphereFrame(cur, reachable);
      out.push(cur);
    }
    return out;
  };

  it('cycles none → galactic → equatorial → none near Sol', () => {
    expect(cycle('none', true, 4)).toEqual(['galactic', 'equatorial', 'none', 'galactic']);
  });

  it('skips the equatorial stop entirely once it has faded out', () => {
    expect(cycle('none', false, 4)).toEqual(['galactic', 'none', 'galactic', 'none']);
  });

  // Restoring a `?v=` link written near Sol can land the equatorial sphere on
  // an unreachable camera; `S` must still walk it back to none.
  it('leaves an already-selected equatorial sphere when unreachable', () => {
    expect(nextCoordSphereFrame('equatorial', false)).toBe('none');
  });
});
