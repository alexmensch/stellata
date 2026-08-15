import { describe, expect, it } from 'vitest';

import { AU_KM, J2000_OBLIQUITY_RAD, KM_PC } from '../../util/astronomy-constants';
import {
  earthMoonSplit,
  MOON_ELEMENTS,
  MOON_MASS_FRACTION,
  moonOffsetEcliptic,
  type MoonElements,
} from './moon-ephemeris';
import type { Vec3 } from './ephemeris';
import { SOL_MOONS } from '../planet-system';
import { julianEpochYearToT } from '../time/time';

const DEG = Math.PI / 180;
const elem = (name: string): MoonElements =>
  MOON_ELEMENTS.find((m) => m.name === name)!;

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function mag(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}
function normalize(v: Vec3): Vec3 {
  const m = mag(v);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

// The moon's reference-plane pole, rotated ICRS → ecliptic (Rx(−ε)) — the
// axis its orbit normal should line up with under the resolver's frame
// composition.
function refPoleEcliptic(m: MoonElements): Vec3 {
  const a = m.refPoleRaDeg! * DEG;
  const d = m.refPoleDecDeg! * DEG;
  const icrs = { x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d) };
  const ce = Math.cos(J2000_OBLIQUITY_RAD), se = Math.sin(J2000_OBLIQUITY_RAD);
  return { x: icrs.x, y: ce * icrs.y + se * icrs.z, z: -se * icrs.y + ce * icrs.z };
}

// Orbit normal (unit) sampled from two nearby epochs a small fraction of
// the period apart — direction of r(t0) × r(t1).
function orbitNormal(m: MoonElements, t0: number): Vec3 {
  const dtSec = (m.periodDays / 500) * 86400;
  const r0: Vec3 = { x: 0, y: 0, z: 0 };
  const r1: Vec3 = { x: 0, y: 0, z: 0 };
  moonOffsetEcliptic(m, t0, r0);
  moonOffsetEcliptic(m, t0 + dtSec, r1);
  return normalize(cross(r0, r1));
}

const T_J2000 = julianEpochYearToT(2000.0);

const EXPECTED_MOONS: Record<string, string> = {
  Moon: 'Earth',
  Io: 'Jupiter', Europa: 'Jupiter', Ganymede: 'Jupiter', Callisto: 'Jupiter',
  Mimas: 'Saturn', Enceladus: 'Saturn', Tethys: 'Saturn', Dione: 'Saturn',
  Rhea: 'Saturn', Titan: 'Saturn', Iapetus: 'Saturn',
  Miranda: 'Uranus', Ariel: 'Uranus', Umbriel: 'Uranus', Titania: 'Uranus', Oberon: 'Uranus',
  Triton: 'Neptune',
};

describe('MOON_ELEMENTS', () => {
  it('covers exactly the 18 in-scope major moons', () => {
    expect(MOON_ELEMENTS.length).toBe(18);
    const byName = new Map(MOON_ELEMENTS.map((m) => [m.name, m.parent]));
    expect(Object.fromEntries(byName)).toEqual(EXPECTED_MOONS);
  });

  it('has physically sane elements for every moon', () => {
    for (const m of MOON_ELEMENTS) {
      expect(m.aKm, m.name).toBeGreaterThan(0);
      expect(m.e, m.name).toBeGreaterThanOrEqual(0);
      expect(m.e, m.name).toBeLessThan(1);
      expect(m.incDeg, m.name).toBeGreaterThanOrEqual(0);
      expect(m.incDeg, m.name).toBeLessThanOrEqual(180);
      expect(m.periodDays, m.name).toBeGreaterThan(0);
      for (const ang of [m.nodeDeg, m.periDeg, m.m0Deg]) {
        expect(ang, m.name).toBeGreaterThanOrEqual(0);
        expect(ang, m.name).toBeLessThan(360);
      }
    }
  });

  it('matches published semi-major axes', () => {
    const a = (name: string) => MOON_ELEMENTS.find((m) => m.name === name)!.aKm;
    expect(a('Moon')).toBe(384400);
    expect(a('Io')).toBe(421800);
  });

  it('places Triton on a retrograde orbit', () => {
    const triton = MOON_ELEMENTS.find((m) => m.name === 'Triton')!;
    expect(triton.incDeg).toBeGreaterThan(90);
  });

  it('references every moon but the Moon to a Laplace/equatorial pole', () => {
    for (const m of MOON_ELEMENTS) {
      if (m.name === 'Moon') {
        expect(m.refPoleRaDeg).toBeUndefined();
        expect(m.refPoleDecDeg).toBeUndefined();
      } else {
        expect(m.refPoleRaDeg, m.name).toBeTypeOf('number');
        expect(m.refPoleDecDeg, m.name).toBeTypeOf('number');
      }
    }
  });
});

describe('SOL_MOONS', () => {
  it('mirrors MOON_ELEMENTS one-to-one', () => {
    expect(SOL_MOONS.map((m) => m.name).sort()).toEqual(
      MOON_ELEMENTS.map((m) => m.name).sort(),
    );
  });

  it('derives semi-major axis (parent-relative AU) and eccentricity from the elements', () => {
    const elemByName = new Map(MOON_ELEMENTS.map((m) => [m.name, m]));
    for (const moon of SOL_MOONS) {
      const el = elemByName.get(moon.name)!;
      expect(moon.semiMajorAxisAu, moon.name).toBeCloseTo(el.aKm / AU_KM, 12);
      expect(moon.eccentricity, moon.name).toBe(el.e);
      expect(moon.parentName, moon.name).toBe(el.parent);
    }
  });

  it('types only the Moon and Io as rocky, the rest icy', () => {
    const rocky = SOL_MOONS.filter((m) => m.type === 'rocky').map((m) => m.name).sort();
    expect(rocky).toEqual(['Io', 'Moon']);
    expect(SOL_MOONS.every((m) => m.type === 'rocky' || m.type === 'icy')).toBe(true);
  });
});

describe('moonOffsetEcliptic', () => {
  const out: Vec3 = { x: 0, y: 0, z: 0 };

  // The Moon is resolved by the ELP series, not the Kepler solve over its
  // element row, so the two-body invariants below do not describe it. It
  // gets its own, sharper pins straight after.
  const KEPLER_MOONS = MOON_ELEMENTS.filter((m) => !m.useLunarTheory);

  it('keeps parent distance within [a(1−e), a(1+e)] across ±3000 yr', () => {
    // 40 samples spanning the Standish window for every moon.
    const tMin = julianEpochYearToT(-1000.0);
    const tMax = julianEpochYearToT(3000.0);
    for (const m of KEPLER_MOONS) {
      const aPc = m.aKm * KM_PC;
      const lo = aPc * (1 - m.e);
      const hi = aPc * (1 + m.e);
      for (let i = 0; i <= 40; i++) {
        const t = tMin + ((tMax - tMin) * i) / 40;
        moonOffsetEcliptic(m, t, out);
        const r = mag(out);
        expect(r, `${m.name} @ ${i}`).toBeGreaterThanOrEqual(lo * (1 - 1e-9));
        expect(r, `${m.name} @ ${i}`).toBeLessThanOrEqual(hi * (1 + 1e-9));
      }
    }
  });

  it('returns to the same position after one sidereal period', () => {
    for (const m of KEPLER_MOONS) {
      const start: Vec3 = { x: 0, y: 0, z: 0 };
      const after: Vec3 = { x: 0, y: 0, z: 0 };
      moonOffsetEcliptic(m, T_J2000, start);
      moonOffsetEcliptic(m, T_J2000 + m.periodDays * 86400, after);
      const drift = mag({ x: after.x - start.x, y: after.y - start.y, z: after.z - start.z });
      // A modelled libration / node precession legitimately breaks
      // exact single-period recurrence (Mimas's libration advances
      // ~0.01° per orbit); those moons get a bound covering the
      // modelled secular motion, not float noise.
      const tol = m.libAmpDeg !== undefined || m.nodeDegPerDay !== undefined ? 1e-3 : 1e-6;
      expect(drift / mag(start), m.name).toBeLessThan(tol);
    }
  });

  it('exactly one moon is resolved by the lunar theory', () => {
    const theoryMoons = MOON_ELEMENTS.filter((m) => m.useLunarTheory).map((m) => m.name);
    expect(theoryMoons).toEqual(['Moon']);
  });

  it('sweeps the Moon through its true perigee–apogee range, not the mean ellipse', () => {
    // 356 400 – 406 700 km is the published extreme range; the mean
    // ellipse a(1±e) only reaches 363 100 – 405 700, so a regression to
    // the element row shows up as a range that never gets near perigee.
    const moon = MOON_ELEMENTS.find((m) => m.name === 'Moon')!;
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < 4000; i++) {
      moonOffsetEcliptic(moon, T_J2000 + i * 6 * 3600, out);
      const km = mag(out) / KM_PC;
      lo = Math.min(lo, km);
      hi = Math.max(hi, km);
    }
    expect(lo).toBeGreaterThan(356000);
    expect(lo).toBeLessThan(359000);
    expect(hi).toBeGreaterThan(405500);
    expect(hi).toBeLessThan(407000);
  });

  it('does NOT repeat after one sidereal month — evection and the advancing apse', () => {
    // The tripwire against a silent fall-back to the fixed ellipse: a
    // Kepler solve returns to within 1e-6 of its start after exactly
    // periodDays, and the real Moon cannot.
    const moon = MOON_ELEMENTS.find((m) => m.name === 'Moon')!;
    const start: Vec3 = { x: 0, y: 0, z: 0 };
    const after: Vec3 = { x: 0, y: 0, z: 0 };
    moonOffsetEcliptic(moon, T_J2000, start);
    moonOffsetEcliptic(moon, T_J2000 + moon.periodDays * 86400, after);
    const drift = mag({
      x: after.x - start.x, y: after.y - start.y, z: after.z - start.z,
    }) / mag(start);
    expect(drift).toBeGreaterThan(1e-3);
    expect(drift).toBeLessThan(0.05);
  });

  it('produces a measurable displacement at a quarter period', () => {
    for (const m of MOON_ELEMENTS) {
      const start: Vec3 = { x: 0, y: 0, z: 0 };
      const quarter: Vec3 = { x: 0, y: 0, z: 0 };
      moonOffsetEcliptic(m, T_J2000, start);
      moonOffsetEcliptic(m, T_J2000 + (m.periodDays / 4) * 86400, quarter);
      const step = mag({ x: quarter.x - start.x, y: quarter.y - start.y, z: quarter.z - start.z });
      // A quarter-orbit sweep is order-of-a itself, never sub-milli-a.
      expect(step / mag(start), m.name).toBeGreaterThan(0.1);
    }
  });

  it('places the geocentric Moon at ~384,400 km on the ecliptic', () => {
    moonOffsetEcliptic(elem('Moon'), T_J2000, out);
    const km = mag(out) / KM_PC;
    expect(km).toBeGreaterThan(363000);
    expect(km).toBeLessThan(406000);
    // The Moon's orbit sits ~5° off the ecliptic, NOT ~23° — proof it is
    // not being rotated through Earth's equatorial pole.
    const n = orbitNormal(elem('Moon'), T_J2000);
    const tiltDeg = Math.acos(Math.min(1, Math.abs(n.z))) / DEG;
    expect(tiltDeg).toBeGreaterThan(3);
    expect(tiltDeg).toBeLessThan(8);
  });

  it('aligns a Galilean orbit normal with Jupiter’s reference pole', () => {
    // Io's inclination to its reference plane is ~0, so its orbit normal
    // must land on the reference pole once rotated into the ecliptic —
    // validates the reference-plane → ecliptic composition direction.
    const io = elem('Io');
    const n = orbitNormal(io, T_J2000);
    const pole = refPoleEcliptic(io);
    const angleDeg = Math.acos(Math.min(1, Math.abs(n.x * pole.x + n.y * pole.y + n.z * pole.z))) / DEG;
    expect(angleDeg).toBeLessThan(1);
  });

  it('sweeps Triton retrograde and the Galileans prograde about their poles', () => {
    // Angular momentum r×v aligned with the reference pole ⇒ prograde
    // (positive dot); anti-aligned ⇒ retrograde. Triton (i≈157°) is the
    // one retrograde major moon.
    const dot = (m: MoonElements): number => {
      const n = orbitNormal(m, T_J2000);
      const p = refPoleEcliptic(m);
      return n.x * p.x + n.y * p.y + n.z * p.z;
    };
    expect(dot(elem('Triton'))).toBeLessThan(0);
    for (const name of ['Io', 'Europa', 'Ganymede', 'Callisto']) {
      expect(dot(elem(name)), name).toBeGreaterThan(0);
    }
  });
});

describe('earthMoonSplit', () => {
  it('offsets Earth from the barycentre by the Moon mass fraction of r', () => {
    const bary: Vec3 = { x: 1.2, y: -0.4, z: 0.05 };
    const moonGeo: Vec3 = { x: 0, y: 0, z: 0 };
    moonOffsetEcliptic(elem('Moon'), T_J2000, moonGeo);
    const earth: Vec3 = { x: 0, y: 0, z: 0 };
    const moon: Vec3 = { x: 0, y: 0, z: 0 };
    earthMoonSplit(bary, moonGeo, earth, moon);

    // Earth sits MOON_MASS_FRACTION·r back from the barycentre — ~4700 km.
    const earthOff = mag({ x: earth.x - bary.x, y: earth.y - bary.y, z: earth.z - bary.z });
    expect(earthOff / KM_PC).toBeGreaterThan(4000);
    expect(earthOff / KM_PC).toBeLessThan(5500);
    expect(earthOff).toBeCloseTo(MOON_MASS_FRACTION * mag(moonGeo), 12);

    // Moon − Earth reproduces the geocentric offset exactly.
    expect(moon.x - earth.x).toBeCloseTo(moonGeo.x, 12);
    expect(moon.y - earth.y).toBeCloseTo(moonGeo.y, 12);
    expect(moon.z - earth.z).toBeCloseTo(moonGeo.z, 12);

    // Mass-weighted centroid recovers the barycentre.
    const f = MOON_MASS_FRACTION;
    expect((1 - f) * earth.x + f * moon.x).toBeCloseTo(bary.x, 12);
    expect((1 - f) * earth.y + f * moon.y).toBeCloseTo(bary.y, 12);
    expect((1 - f) * earth.z + f * moon.z).toBeCloseTo(bary.z, 12);
  });
});
