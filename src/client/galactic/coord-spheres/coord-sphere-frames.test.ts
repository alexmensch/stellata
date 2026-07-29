import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { unitVectorFromRaDec } from '../../util/equatorial-basis';
import { GALACTIC_NORTH_POLE_ICRS, galacticDirToIcrs } from '../galactic-coords';
import type { CoordSphereFrame, CoordSphereSpec, DrawnCoordSphereFrame } from './coord-sphere';
import { solFrameFadeFactor } from '../galactic-fade';
import {
  COORD_SPHERE_SPECS,
  DRAWN_COORD_SPHERE_FRAMES,
  EQUATORIAL_FADE_WINDOW_PC,
  EQUATORIAL_SPHERE_SPEC,
  GALACTIC_SPHERE_SPEC,
  coordSphereFadeAt,
  coordSphereReachableAt,
  equatorialDirToIcrs,
  fmtDecDeg,
  fmtLatDeg,
  fmtLonDeg,
  fmtRaHours,
  nextCoordSphereFrame,
} from './coord-sphere-frames';

const DEG = Math.PI / 180;
const ARCSEC = DEG / 3600;

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

/**
 * Published ICRS J2000 α/δ and galactic l/b for four naked-eye stars, both
 * read off the catalogues rather than derived from each other or from this
 * repo — which is what makes the pair an independent check on the frames.
 * Polaris is in for the near-pole case, where the trimmed meridians converge.
 */
const STARS = [
  { name: 'Sirius',     raDeg: 101.28715533, decDeg: -16.71611586, lDeg: 227.2303, bDeg:  -8.8903 },
  { name: 'Betelgeuse', raDeg:  88.79293899, decDeg:   7.40706400, lDeg: 199.7872, bDeg:  -8.9586 },
  { name: 'Vega',       raDeg: 279.23473479, decDeg:  38.78368896, lDeg:  67.4479, bDeg:  19.2373 },
  { name: 'Polaris',    raDeg:  37.95456067, decDeg:  89.26410897, lDeg: 123.2810, bDeg:  26.4612 },
];

// Published l/b carry four decimal degrees (0.36″), and near the pole a
// rounded longitude moves the direction by more than its own quantum, so the
// galactic node can sit up to ~2″ off a star fixed by its α/δ. Nothing about
// the rotation itself is that imprecise — GAL_TO_ICRS re-orthogonalises.
const PUBLISHED_LB_ROUNDING_ARCSEC = 2;

function sepArcsec(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) / ARCSEC;
}

/** Invert `spec`'s frame at an ICRS direction: the longitude/latitude the grid
 *  claims for it, which is what its meridian and ring labels read out. */
function frameCoordsOf(spec: CoordSphereSpec, dir: THREE.Vector3) {
  const lonAxis = spec.dirToIcrs(0, 0, new THREE.Vector3());
  const quadrant = spec.dirToIcrs(Math.PI / 2, 0, new THREE.Vector3());
  const pole = spec.dirToIcrs(0, Math.PI / 2, new THREE.Vector3());
  const lonRad = Math.atan2(dir.dot(quadrant), dir.dot(lonAxis));
  return {
    lonDeg: ((lonRad / DEG) % 360 + 360) % 360,
    latDeg: Math.asin(Math.min(1, Math.max(-1, dir.dot(pole)))) / DEG,
  };
}

// A grid whose frame is subtly wrong still looks like a plausible grid, so the
// binding assertion is against real stars at published coordinates: each one
// must sit exactly where its own α/δ node is drawn, and where its published
// galactic l/b node is drawn, on the two spheres respectively.
describe('published star positions against the drawn spheres', () => {
  for (const star of STARS) {
    const u = unitVectorFromRaDec(star.raDeg, star.decDeg);
    const dir = new THREE.Vector3(u.x, u.y, u.z);

    it(`puts ${star.name} on its published RA/Dec node`, () => {
      const node = equatorialDirToIcrs(star.raDeg * DEG, star.decDeg * DEG, new THREE.Vector3());
      expect(sepArcsec(dir, node)).toBeLessThan(1e-6);

      const { lonDeg, latDeg } = frameCoordsOf(EQUATORIAL_SPHERE_SPEC, dir);
      expect(lonDeg).toBeCloseTo(star.raDeg, 9);
      expect(latDeg).toBeCloseTo(star.decDeg, 9);
    });

    it(`puts ${star.name} on its published galactic l/b node`, () => {
      const node = galacticDirToIcrs(star.lDeg * DEG, star.bDeg * DEG, new THREE.Vector3());
      expect(sepArcsec(dir, node)).toBeLessThan(PUBLISHED_LB_ROUNDING_ARCSEC);

      const { lonDeg, latDeg } = frameCoordsOf(GALACTIC_SPHERE_SPEC, dir);
      expect(lonDeg).toBeCloseTo(star.lDeg, 3);
      expect(latDeg).toBeCloseTo(star.bDeg, 3);
    });
  }

  // Same star, same sky, two grids: if the specs had ended up sharing a frame
  // the two readings would agree, and every assertion above would still pass.
  it('reads a different longitude and latitude per frame', () => {
    for (const star of STARS) {
      const u = unitVectorFromRaDec(star.raDeg, star.decDeg);
      const dir = new THREE.Vector3(u.x, u.y, u.z);
      const eq = frameCoordsOf(EQUATORIAL_SPHERE_SPEC, dir);
      const gal = frameCoordsOf(GALACTIC_SPHERE_SPEC, dir);
      expect(Math.abs(eq.latDeg - gal.latDeg)).toBeGreaterThan(1);
    }
  });

  // The label a user reads off the meridian nearest a star has to be the hour
  // of that star's right ascension — Sirius at α 101.287° sits in the 7th hour.
  it('labels the hour circle nearest a star with that star’s RA hour', () => {
    const nearestHourLabel = (raDeg: number) => {
      const n = EQUATORIAL_SPHERE_SPEC.meridianCount;
      const i = Math.round((raDeg / 360) * n) % n;
      return EQUATORIAL_SPHERE_SPEC.lonLabel((i * 360) / n);
    };
    expect(nearestHourLabel(STARS[0].raDeg)).toBe('7h');   // Sirius, 06h 45m
    expect(nearestHourLabel(STARS[1].raDeg)).toBe('6h');   // Betelgeuse, 05h 55m
    expect(nearestHourLabel(STARS[2].raDeg)).toBe('19h');  // Vega, 18h 37m
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

  it('tables every drawn frame exactly once', () => {
    expect(DRAWN_COORD_SPHERE_FRAMES).toEqual(['galactic', 'equatorial']);
    expect(Object.keys(COORD_SPHERE_SPECS).sort())
      .toEqual([...DRAWN_COORD_SPHERE_FRAMES].sort());
  });

  // Only a frame anchored to Earth self-hides; the galactic one is meaningful
  // from anywhere, so an accidental window on it would hide the wrong sphere.
  it('gives a fade window to the equatorial frame alone', () => {
    expect(GALACTIC_SPHERE_SPEC.fadeWindow).toBeUndefined();
    expect(EQUATORIAL_SPHERE_SPEC.fadeWindow).toBe(EQUATORIAL_FADE_WINDOW_PC);
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

const ALPHA_CEN_PC = 1.34;
// Neptune's semi-major axis, as a stand-in for "still inside the planets".
const NEPTUNE_PC = 30.07 / 206_264.8;

describe('EQUATORIAL_FADE_WINDOW_PC', () => {
  it('is the sub-parsec-to-a-few-parsecs window sp4q derived', () => {
    expect(EQUATORIAL_FADE_WINDOW_PC).toEqual({ innerPc: 0.4, outerPc: 2.0 });
  });

  it('holds the sphere at full strength across the solar system', () => {
    expect(coordSphereFadeAt('equatorial', NEPTUNE_PC)).toBe(1);
  });

  // An Earth-referenced frame has to be mostly gone by the nearest star; the
  // whole reason it fades is that it stops describing anyone's sky out there.
  it('has faded most of the way out by α Cen', () => {
    expect(coordSphereFadeAt('equatorial', ALPHA_CEN_PC)).toBeCloseTo(0.370090, 6);
  });
});

describe('coordSphereFadeAt', () => {
  it('never fades the galactic sphere, at any distance', () => {
    for (const d of [0, 2, 1e3, 1e6]) expect(coordSphereFadeAt('galactic', d)).toBe(1);
  });

  it('tracks the shared Sol-frame curve for a frame that has a window', () => {
    for (const d of [0, 0.4, 1, 1.9, 2, 10]) {
      expect(coordSphereFadeAt('equatorial', d))
        .toBe(solFrameFadeFactor(d, EQUATORIAL_FADE_WINDOW_PC));
    }
  });

  it('bounds to [0, 1] across the whole travel range', () => {
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
      for (const d of [0, 0.4, 1, 2, 10, 1e6]) {
        const f = coordSphereFadeAt(frame, d);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('coordSphereReachableAt', () => {
  it('holds inside the window and fails at or past the outer edge', () => {
    expect(coordSphereReachableAt('equatorial', 0)).toBe(true);
    expect(coordSphereReachableAt('equatorial', EQUATORIAL_FADE_WINDOW_PC.innerPc)).toBe(true);
    expect(coordSphereReachableAt('equatorial', ALPHA_CEN_PC)).toBe(true);
    expect(coordSphereReachableAt('equatorial', EQUATORIAL_FADE_WINDOW_PC.outerPc)).toBe(false);
    expect(coordSphereReachableAt('equatorial', 1e6)).toBe(false);
  });

  it('keeps the galactic sphere reachable from outside the galaxy', () => {
    expect(coordSphereReachableAt('galactic', 1e6)).toBe(true);
  });

  // The scene layer deselects on exactly this predicate and then draws at
  // coordSphereFadeAt, so a reachable sphere must never draw at zero alpha.
  it('is true exactly when the sphere draws at a positive alpha', () => {
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
      for (const d of [0, 0.2, 0.4, 1, 1.9, 2, 2.1, 10]) {
        expect(coordSphereReachableAt(frame, d)).toBe(coordSphereFadeAt(frame, d) > 0);
      }
    }
  });
});

describe('nextCoordSphereFrame', () => {
  const anywhere = () => true;
  const nearSolOnly = (frame: DrawnCoordSphereFrame) => frame !== 'equatorial';

  const cycle = (
    start: CoordSphereFrame,
    reachable: (frame: DrawnCoordSphereFrame) => boolean,
    steps: number,
  ) => {
    const out: CoordSphereFrame[] = [];
    let cur = start;
    for (let i = 0; i < steps; i++) {
      cur = nextCoordSphereFrame(cur, reachable);
      out.push(cur);
    }
    return out;
  };

  it('cycles none → galactic → equatorial → none near Sol', () => {
    expect(cycle('none', anywhere, 4)).toEqual(['galactic', 'equatorial', 'none', 'galactic']);
  });

  it('skips the equatorial stop entirely once it has faded out', () => {
    expect(cycle('none', nearSolOnly, 4)).toEqual(['galactic', 'none', 'galactic', 'none']);
  });

  // Restoring a `?v=` link written near Sol can land the equatorial sphere on
  // an unreachable camera; `S` must still walk it back to none.
  it('leaves an already-selected equatorial sphere when unreachable', () => {
    expect(nextCoordSphereFrame('equatorial', nearSolOnly)).toBe('none');
  });

  it('terminates on none when nothing is reachable', () => {
    expect(cycle('none', () => false, 3)).toEqual(['none', 'none', 'none']);
  });
});
