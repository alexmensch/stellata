import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { unitVectorFromRaDec } from '../../util/equatorial-basis';
import { GALACTIC_NORTH_POLE_ICRS, galacticDirToIcrs } from '../galactic-coords';
import type { CoordSphereFrame, CoordSphereSpec, DrawnCoordSphereFrame } from './coord-sphere';
import {
  COORD_SPHERE_FRAMES,
  COORD_SPHERE_SPECS,
  DRAWN_COORD_SPHERE_FRAMES,
  EQUATORIAL_SPHERE_SPEC,
  GALACTIC_SPHERE_SPEC,
  coordSphereNorthPole,
  ECLIPTIC_SPHERE_SPEC,
  OBLIQUITY_RAD,
  eclipticDirToIcrs,
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

function dirOf(raDeg: number, decDeg: number): THREE.Vector3 {
  const u = unitVectorFromRaDec(raDeg, decDeg);
  return new THREE.Vector3(u.x, u.y, u.z);
}

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

  // One pool per sphere, so two frames sharing a group would have their
  // labels fight in a single repulsion pass.
  it('pools every label set under its own SVG group', () => {
    const groups = DRAWN_COORD_SPHERE_FRAMES.map(f => COORD_SPHERE_SPECS[f].labelGroupId);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('tables every drawn frame exactly once, widest plane first', () => {
    expect(DRAWN_COORD_SPHERE_FRAMES).toEqual(['galactic', 'ecliptic', 'equatorial']);
    expect(Object.keys(COORD_SPHERE_SPECS).sort())
      .toEqual([...DRAWN_COORD_SPHERE_FRAMES].sort());
  });

  // Ecliptic longitude is degrees; only the equatorial grid's meridians are
  // hour circles, and only it may label them in hours.
  it('gives the ecliptic grid the galactic parametrisation, not the hour circles', () => {
    expect(ECLIPTIC_SPHERE_SPEC.meridianCount).toBe(GALACTIC_SPHERE_SPEC.meridianCount);
    expect(ECLIPTIC_SPHERE_SPEC.lonLabel).toBe(GALACTIC_SPHERE_SPEC.lonLabel);
    expect(EQUATORIAL_SPHERE_SPEC.meridianCount).toBe(24);
  });
});

// `L` levels against this pole, so it has to be the pole of the grid actually
// drawn — derived through the same dirToIcrs, never a second constant that
// could drift from the geometry.
describe('coordSphereNorthPole', () => {
  it('is each frame’s own +90° latitude', () => {
    expect(sepArcsec(coordSphereNorthPole('galactic'), GALACTIC_NORTH_POLE_ICRS)).toBeLessThan(1e-6);
    const ncp = coordSphereNorthPole('equatorial');
    expect(ncp.x).toBeCloseTo(0, 12);
    expect(ncp.y).toBeCloseTo(0, 12);
    expect(ncp.z).toBeCloseTo(1, 12);
  });

  it('is the ecliptic pole at α 18h, δ +66.56° for the ecliptic frame', () => {
    expect(sepArcsec(coordSphereNorthPole('ecliptic'),
      dirOf(18 * 15, 90 - OBLIQUITY_RAD / DEG))).toBeLessThan(1);
  });

  it('levels against galactic north when no sphere is up', () => {
    expect(coordSphereNorthPole('none')).toBe(coordSphereNorthPole('galactic'));
  });

  // Levelling projects the pole into the image plane and reads the residual as
  // an angle; a non-unit pole would bias it.
  it('returns unit vectors for every frame', () => {
    for (const frame of COORD_SPHERE_FRAMES) {
      expect(coordSphereNorthPole(frame).length()).toBeCloseTo(1, 12);
    }
  });
});

// The ecliptic frame is pinned against three published anchors rather than
// against the equatorial one it is derived from, which would only restate the
// rotation. Pole and equinox fix the two axes; the solstice is what catches an
// obliquity of the wrong sign, which would still land a pole 66.56° from the
// equator — just the wrong one.
describe('eclipticDirToIcrs', () => {
  it('shares the vernal equinox with the equatorial frame', () => {
    const v = eclipticDirToIcrs(0, 0, new THREE.Vector3());
    expect(sepArcsec(v, dirOf(0, 0))).toBeLessThan(1e-6);
  });

  it('puts its pole at α 18h, δ +66.56°', () => {
    const pole = eclipticDirToIcrs(0, Math.PI / 2, new THREE.Vector3());
    expect(sepArcsec(pole, dirOf(18 * 15, 90 - OBLIQUITY_RAD / DEG))).toBeLessThan(1);
  });

  it('puts the summer solstice at α 6h, δ +23.44°', () => {
    const solstice = eclipticDirToIcrs(Math.PI / 2, 0, new THREE.Vector3());
    expect(sepArcsec(solstice, dirOf(6 * 15, OBLIQUITY_RAD / DEG))).toBeLessThan(1);
  });

  it('is a rotation — it preserves angles between directions', () => {
    const a = eclipticDirToIcrs(0.7, 0.3, new THREE.Vector3());
    const b = eclipticDirToIcrs(2.1, -0.9, new THREE.Vector3());
    const ea = dirOf((0.7 / DEG), (0.3 / DEG));
    const eb = dirOf((2.1 / DEG), (-0.9 / DEG));
    expect(a.length()).toBeCloseTo(1, 12);
    expect(a.dot(b)).toBeCloseTo(ea.dot(eb), 12);
  });

  // A third grid earns its place only by reading differently from both the
  // others; an ecliptic spec that had collapsed onto one of them would draw a
  // plausible sphere and pass every assertion above.
  it('reads a latitude of its own for every pinned star', () => {
    for (const star of STARS) {
      const dir = dirOf(star.raDeg, star.decDeg);
      const ecl = frameCoordsOf(ECLIPTIC_SPHERE_SPEC, dir);
      const eq = frameCoordsOf(EQUATORIAL_SPHERE_SPEC, dir);
      const gal = frameCoordsOf(GALACTIC_SPHERE_SPEC, dir);
      expect(Math.abs(ecl.latDeg - eq.latDeg)).toBeGreaterThan(1);
      expect(Math.abs(ecl.latDeg - gal.latDeg)).toBeGreaterThan(1);
    }
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
  const anywhere = () => true;
  const offEarth = (frame: DrawnCoordSphereFrame) => frame !== 'equatorial';

  const cycle = (
    start: CoordSphereFrame,
    available: (frame: DrawnCoordSphereFrame) => boolean,
    steps: number,
  ) => {
    const out: CoordSphereFrame[] = [];
    let cur = start;
    for (let i = 0; i < steps; i++) {
      cur = nextCoordSphereFrame(cur, available);
      out.push(cur);
    }
    return out;
  };

  it('cycles none → galactic → ecliptic → equatorial → none from Earth', () => {
    expect(cycle('none', anywhere, 5))
      .toEqual(['galactic', 'ecliptic', 'equatorial', 'none', 'galactic']);
  });

  it('skips the equatorial stop entirely away from Earth', () => {
    expect(cycle('none', offEarth, 4))
      .toEqual(['galactic', 'ecliptic', 'none', 'galactic']);
  });

  // A shared link written from Earth can restore the equatorial sphere onto a
  // focus that gives it no meaning; `S` must still walk it back out.
  it('leaves an already-selected equatorial sphere when it is unavailable', () => {
    expect(nextCoordSphereFrame('equatorial', offEarth)).toBe('none');
  });

  it('terminates on none when nothing is available', () => {
    expect(cycle('none', () => false, 3)).toEqual(['none', 'none', 'none']);
  });
});
