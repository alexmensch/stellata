import { describe, expect, it } from 'vitest';
import {
  EARTH_ROTATION,
  JUPITER_ROTATION,
  MERCURY_ROTATION,
  MOON_ROTATION_BY_NAME,
  PLUTO_ROTATION,
  poleRaDecDegAt,
  poleVectorAt,
  spinDegAt,
  subObserverLongitudeEastDeg,
  URANUS_ROTATION,
  VENUS_ROTATION,
} from './rotation-elements-pure';
import { getPlanetPositions } from '../../ephemerides/ephemeris';
import { MOON_ELEMENTS, moonOffsetEcliptic } from '../../ephemerides/moon-ephemeris';
import { ECLIPTIC_NORTH_POLE_ICRS } from '../../ephemerides/orbit-rings-layer';
import { SOL_MOONS } from '../../planet-system';
import { jdeToT, T_CLAMP_MAX_S, T_CLAMP_MIN_S } from '../../time/time';
import { J2000_JD, J2000_OBLIQUITY_RAD } from '../../../util/astronomy-constants';

const T_J2000 = jdeToT(J2000_JD);

/** Planet→Sun unit vector in ICRS at Unix-seconds `t`, from the same
 *  ephemeris + ecliptic→ICRS rotation the renderer applies. */
function sunDirIcrsFrom(
  body: 'earth' | 'venus',
  t: number,
): { x: number; y: number; z: number } {
  const p = getPlanetPositions(t)[body];
  const sinE = -ECLIPTIC_NORTH_POLE_ICRS.y;
  const cosE = ECLIPTIC_NORTH_POLE_ICRS.z;
  const x = -p.x;
  const y = -(p.y * cosE - p.z * sinE);
  const z = -(p.y * sinE + p.z * cosE);
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

describe('rotation element tables', () => {
  it('pins the IAU 2015 headline rates (pck00011)', () => {
    expect(EARTH_ROTATION.wDegPerDay).toBe(360.9856235);
    expect(JUPITER_ROTATION.wDegPerDay).toBe(870.536);
    expect(MERCURY_ROTATION.wDegPerDay).toBe(6.1385108);
    expect(EARTH_ROTATION.poleRaDegPerCty).toBe(-0.641);
  });

  it('Venus and Uranus spin retrograde about their IAU north poles', () => {
    expect(VENUS_ROTATION.wDegPerDay).toBeLessThan(0);
    expect(URANUS_ROTATION.wDegPerDay).toBeLessThan(0);
  });

  it('Pluto map is centred on 180°E (Sputnik Planitia at map centre)', () => {
    expect(PLUTO_ROTATION.mapCenterLonDeg).toBe(180);
  });
});

describe('poleVectorAt', () => {
  it('Earth pole at J2000 is the north celestial pole', () => {
    const out = { x: 0, y: 0, z: 0 };
    poleVectorAt(EARTH_ROTATION, T_J2000, out);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(1, 6);
  });

  it('Uranus IAU pole sits ~82.2° from the ecliptic pole (98° obliquity with retrograde spin)', () => {
    const out = { x: 0, y: 0, z: 0 };
    poleVectorAt(URANUS_ROTATION, T_J2000, out);
    const dot =
      out.x * ECLIPTIC_NORTH_POLE_ICRS.x +
      out.y * ECLIPTIC_NORTH_POLE_ICRS.y +
      out.z * ECLIPTIC_NORTH_POLE_ICRS.z;
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    expect(angleDeg).toBeGreaterThan(81.5);
    expect(angleDeg).toBeLessThan(83);
  });

  it('Earth pole precesses away from the NCP over centuries', () => {
    const { raDeg, decDeg } = poleRaDecDegAt(EARTH_ROTATION, T_CLAMP_MAX_S);
    expect(decDeg).toBeLessThan(90);
    expect(raDeg).not.toBe(0);
  });
});

describe('spinDegAt', () => {
  it('wraps to [0, 360) across the whole model-clock window', () => {
    for (const t of [T_CLAMP_MIN_S, T_J2000, Date.UTC(2026, 6, 1) / 1000, T_CLAMP_MAX_S]) {
      const w = spinDegAt(EARTH_ROTATION, t);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(360);
    }
  });

  it('advances by the daily rate', () => {
    const t0 = Date.UTC(2026, 0, 1) / 1000;
    const w0 = spinDegAt(MERCURY_ROTATION, t0);
    const w1 = spinDegAt(MERCURY_ROTATION, t0 + 86400);
    const delta = ((w1 - w0) % 360 + 360) % 360;
    expect(delta).toBeCloseTo(MERCURY_ROTATION.wDegPerDay, 6);
  });
});

describe('subObserverLongitudeEastDeg — Earth sub-solar point', () => {
  // 2026-06-13 sits at an equation-of-time zero crossing, so the
  // sub-solar longitude at 12:00 UTC is ~0° (Greenwich noon). Budget:
  // EoT residual ±0.3°, UTC-vs-TDB ~0.3°, Standish/EM-bary ≪ 0.1°.
  const NOON = Date.UTC(2026, 5, 13, 12) / 1000;

  it('Greenwich noon puts the sub-solar point near 0° longitude', () => {
    const lon = subObserverLongitudeEastDeg(EARTH_ROTATION, NOON, sunDirIcrsFrom('earth', NOON));
    expect(Math.abs(lon)).toBeLessThan(1.5);
  });

  it('midnight UTC puts the sub-solar point near the antimeridian', () => {
    const t = NOON - 12 * 3600;
    const lon = subObserverLongitudeEastDeg(EARTH_ROTATION, t, sunDirIcrsFrom('earth', t));
    expect(Math.abs(Math.abs(lon) - 180)).toBeLessThan(1.5);
  });

  it('sub-solar point drifts west ~15°/hour', () => {
    const lonA = subObserverLongitudeEastDeg(EARTH_ROTATION, NOON, sunDirIcrsFrom('earth', NOON));
    const tB = NOON + 3600;
    const lonB = subObserverLongitudeEastDeg(EARTH_ROTATION, tB, sunDirIcrsFrom('earth', tB));
    const drift = ((lonA - lonB) % 360 + 360) % 360;
    expect(drift).toBeGreaterThan(14.9);
    expect(drift).toBeLessThan(15.1);
  });

  // Venus's retrograde spin makes its sub-solar point drift EAST (the
  // sun rises in the west) at 360° per 116.75-day solar day — an
  // emergent value combining the negative Ẇ with the orbital rate, so
  // a handedness error anywhere in the chain fails this.
  it('Venus sub-solar point drifts east ~3.08°/day (retrograde solar day)', () => {
    const dayS = 86400;
    const lonA = subObserverLongitudeEastDeg(VENUS_ROTATION, NOON, sunDirIcrsFrom('venus', NOON));
    const tB = NOON + dayS;
    const lonB = subObserverLongitudeEastDeg(VENUS_ROTATION, tB, sunDirIcrsFrom('venus', tB));
    const drift = ((lonB - lonA) % 360 + 360) % 360;
    expect(drift).toBeGreaterThan(2.9);
    expect(drift).toBeLessThan(3.3);
  });
});

describe('MOON_ROTATION_BY_NAME', () => {
  it('covers every SOL_MOONS body', () => {
    for (const m of SOL_MOONS) {
      expect(MOON_ROTATION_BY_NAME.get(m.name), m.name).toBeDefined();
    }
    expect(MOON_ROTATION_BY_NAME.size).toBe(SOL_MOONS.length);
  });

  it('tidal lock: |wDegPerDay| equals the orbital mean motion 360/periodDays', () => {
    for (const elem of MOON_ELEMENTS) {
      const rot = MOON_ROTATION_BY_NAME.get(elem.name)!;
      const meanMotion = 360 / elem.periodDays;
      // IAU W rates and the JPL mean-element periods are independent
      // sources; sub-0.2% agreement is the tidal-lock cross-check.
      expect(
        Math.abs(Math.abs(rot.wDegPerDay) - meanMotion) / meanMotion,
        elem.name,
      ).toBeLessThan(2e-3);
    }
  });

  it('retrograde spins carry negative W rates (Uranian moons, Triton)', () => {
    for (const name of ['Miranda', 'Ariel', 'Umbriel', 'Titania', 'Oberon', 'Triton']) {
      expect(MOON_ROTATION_BY_NAME.get(name)!.wDegPerDay).toBeLessThan(0);
    }
    expect(MOON_ROTATION_BY_NAME.get('Moon')!.wDegPerDay).toBeGreaterThan(0);
  });

  it("the Moon's near side faces Earth: sub-Earth longitude stays near 0°E", () => {
    // Tidal lock in the composed frame: the direction moon → Earth,
    // pushed through the IAU pole + spin inversion, must land near
    // longitude 0 (mean libration excursions are a few degrees; the
    // dropped periodic terms and mean elements widen the tolerance).
    const moonRot = MOON_ROTATION_BY_NAME.get('Moon')!;
    const moonEl = MOON_ELEMENTS.find((m) => m.name === 'Moon')!;
    const off = { x: 0, y: 0, z: 0 };
    const eps = J2000_OBLIQUITY_RAD;
    for (const dayOffset of [0, 7.3, 14.6, 21.9]) {
      const t = 946728000 + dayOffset * 86400;
      moonOffsetEcliptic(moonEl, t, off);
      // Moon → Earth in ecliptic, then ecliptic → ICRS (Rx(+ε)).
      const ex = -off.x;
      const ey = Math.cos(eps) * -off.y - Math.sin(eps) * -off.z;
      const ez = Math.sin(eps) * -off.y + Math.cos(eps) * -off.z;
      const lon = subObserverLongitudeEastDeg(moonRot, t, { x: ex, y: ey, z: ez });
      expect(Math.abs(lon), `t+${dayOffset}d -> ${lon.toFixed(1)}°E`).toBeLessThan(12);
    }
  });
});

describe('periodic libration terms', () => {
  // The visibility bar is the top texture rung: at 8192 a map texel spans
  // 360/8192 = 0.044° of longitude, so a 0.1° term moves features ~2 texels
  // and is visible. Terms under that are below one texel and stay dropped.
  const BAR_DEG = 0.1;

  const withTerms = [...MOON_ROTATION_BY_NAME].filter(([, r]) => r.terms);

  it('carries terms for exactly the bodies with a published amplitude over the bar', () => {
    expect(withTerms.map(([name]) => name).sort()).toEqual([
      'Callisto', 'Europa', 'Ganymede', 'Mimas', 'Moon', 'Rhea', 'Tethys', 'Triton',
    ]);
    // Io's largest is 0.094°, just under — the reason it is absent, and the
    // reason a "why has Io no terms" question has an answer here.
    expect(MOON_ROTATION_BY_NAME.get('Io')!.terms).toBeUndefined();
  });

  it('keeps every stored term at or above the bar', () => {
    for (const [name, rot] of withTerms) {
      for (const term of rot.terms!) {
        const amp = Math.max(
          Math.abs(term.raDeg ?? 0),
          Math.abs(term.decDeg ?? 0),
          Math.abs(term.wDeg ?? 0),
        );
        expect(amp, `${name} term t0=${term.theta0Deg}`).toBeGreaterThanOrEqual(BAR_DEG);
      }
    }
  });

  it('pins the amplitudes that dominate each body', () => {
    // Straight from NAIF pck00011 NUT_PREC coefficients. Mimas and Triton are
    // far larger than the Moon — a point the scoping note for this work had
    // flagged as "verify before trusting", now verified.
    const dominant: Record<string, [number, number, number]> = {
      Moon: [-3.8787, 1.5419, 3.561],
      Europa: [1.086, 0.468, -0.98],
      Ganymede: [0.431, 0.186, -0.389],
      Callisto: [0.59, 0.254, -0.533],
      Mimas: [13.56, -1.53, -13.48],
      Tethys: [9.66, -1.09, -9.6],
      Rhea: [3.1, -0.35, -3.08],
      Triton: [-32.35, 22.55, 22.25],
    };
    for (const [name, [ra, dec, w]] of Object.entries(dominant)) {
      const first = MOON_ROTATION_BY_NAME.get(name)!.terms![0];
      expect(first.raDeg ?? 0, `${name} RA`).toBeCloseTo(ra, 4);
      expect(first.decDeg ?? 0, `${name} Dec`).toBeCloseTo(dec, 4);
      expect(first.wDeg ?? 0, `${name} W`).toBeCloseTo(w, 4);
    }
  });

  it('moves the pole on a circle, not a line — sine on RA, cosine on Dec', () => {
    // The mixed phase IS the convention. Applying the same trig to both would
    // swing the pole along a great-circle arc and back rather than tracing the
    // small circle a nodal regression actually describes.
    const moon = MOON_ROTATION_BY_NAME.get('Moon')!;
    const bare = { ...moon, terms: undefined };
    // Both terms, summed: E1 = 125.045 deg and E2 = 250.089 deg at J2000.
    // Checking E1 alone leaves E2's 0.113 deg on the table and would read as
    // a broken evaluator.
    const rad = (d: number) => (d * Math.PI) / 180;
    const at = poleRaDecDegAt(moon, T_J2000);
    const off = poleRaDecDegAt(bare, T_J2000);
    expect(at.raDeg - off.raDeg).toBeCloseTo(
      -3.8787 * Math.sin(rad(125.045)) - 0.1204 * Math.sin(rad(250.089)), 3);
    expect(at.decDeg - off.decDeg).toBeCloseTo(
      1.5419 * Math.cos(rad(125.045)) + 0.0239 * Math.cos(rad(250.089)), 3);
  });

  it('leaves a body without terms exactly where the linear rows put it', () => {
    const io = MOON_ROTATION_BY_NAME.get('Io')!;
    const T = 0.37;
    const t = jdeToT(J2000_JD + T * 36525);
    expect(poleRaDecDegAt(io, t).raDeg).toBeCloseTo(
      io.poleRaDeg + io.poleRaDegPerCty * T, 9);
  });
});
