// Eclipse circumstances read off the model's own ephemeris, rotation and
// shadow math — the same quantities the mesh shader draws, in the form the
// eclipse canons tabulate. See README.md.

import {
  AU_PER_PC,
  KM_PC,
  LIGHT_TIME_PER_AU_S,
  R_SUN_PC,
} from '../../../util/astronomy-constants';
import { eclipticToIcrs } from '../../../util/ecliptic-frame';
import {
  getPlanetPositions,
  resetPositionCache,
  type Vec3 as EphemVec3,
} from '../../ephemerides/ephemeris';
import {
  earthMoonSplit,
  MOON_ELEMENTS,
  moonOffsetEcliptic,
} from '../../ephemerides/moon-ephemeris';
import { SOL_BODIES } from '../../planet-system';
import { casterShadowFactor } from '../body-shadow-pure';
import {
  EARTH_ROTATION,
  poleRaDecDegAt,
  subObserverLongitudeEastDeg,
} from '../rotation/rotation-elements-pure';
import {
  argMin,
  planetodeticLatRad,
  shadowAxisMiss,
  shadowAxisSurfaceHit,
  umbralMagnitude,
  type Vec3,
} from './eclipse-geometry-pure';

const DEG = Math.PI / 180;

const bodyRadiusPc = (name: string): number =>
  SOL_BODIES.find((b) => b.name === name)!.radiusKm * KM_PC;

export const EARTH_RADIUS_PC = bodyRadiusPc('Earth');
export const MOON_RADIUS_PC = bodyRadiusPc('Moon');
const EARTH_FLATTENING = SOL_BODIES.find((b) => b.name === 'Earth')!.flattening ?? 0;
const MOON_ELEM = MOON_ELEMENTS.find((m) => m.name === 'Moon')!;

// The Sun sits at the origin of the ephemeris frame.
const SUN: Vec3 = { x: 0, y: 0, z: 0 };

const _geo: EphemVec3 = { x: 0, y: 0, z: 0 };
const _earth: EphemVec3 = { x: 0, y: 0, z: 0 };
const _moon: EphemVec3 = { x: 0, y: 0, z: 0 };
const _hit: Vec3 = { x: 0, y: 0, z: 0 };

/** Heliocentric ecliptic positions of Earth's centre and the Moon at `t`.
 *  Returns fresh vectors: every caller here evaluates two epochs for light
 *  time, and shared scratch would leave the first one aliased to the
 *  second. */
export function earthMoonAt(t: number): { earth: Vec3; moon: Vec3 } {
  resetPositionCache();
  const bary = getPlanetPositions(t).earth;
  moonOffsetEcliptic(MOON_ELEM, t, _geo);
  earthMoonSplit(bary, _geo, _earth, _moon);
  return {
    earth: { x: _earth.x, y: _earth.y, z: _earth.z },
    moon: { x: _moon.x, y: _moon.y, z: _moon.z },
  };
}

/**
 * Earth's centre at `t` paired with the **retarded** Moon — the Moon as it
 * was one Earth–Moon light time earlier, which is the one whose shadow is
 * arriving now.
 *
 * Worth 38 km, because the Moon moves ~30 km/s in the inertial frame and
 * Earth does not follow it over 1.28 s. That is a systematic +36 s of
 * greatest-eclipse timing, and it dominated the residual against the
 * canons once the element tables were in. The mesh shader deliberately
 * does NOT do this (see README.md § Light time) — the two paths differ by
 * 0.3 % of Earth's disc.
 */
function earthAndRetardedMoon(t: number): { earth: Vec3; moon: Vec3 } {
  const now = earthMoonAt(t);
  return { earth: now.earth, moon: earthMoonAt(t - earthMoonLightTimeS(now)).moon };
}

/** Earth–Moon light time (s) for a resolved pair. */
function earthMoonLightTimeS(pair: { earth: Vec3; moon: Vec3 }): number {
  return Math.hypot(
    pair.moon.x - pair.earth.x, pair.moon.y - pair.earth.y, pair.moon.z - pair.earth.z,
  ) * AU_PER_PC * LIGHT_TIME_PER_AU_S;
}

export interface GroundPoint {
  latDeg: number;
  lonEastDeg: number;
}

export interface SolarEclipse {
  /** Distance from Earth's centre to the Moon's shadow axis, in Earth
   *  equatorial radii — |γ| in the canons' notation. */
  axisMissEarthRadii: number;
  /** Where the axis meets Earth's surface, planetodetic; null when it
   *  misses Earth entirely. */
  ground: GroundPoint | null;
  /** Sunlight reaching that point through the renderer's own shadow
   *  math: 0 is a full umbra. NOT the total/annular discriminator — the
   *  penumbra smoothstep eases cubically, so a magnitude-0.99 annular
   *  eclipse still reads 7e-5. Use `magnitude` for that. */
  shadowFactor: number;
  /** Ratio of the Moon's apparent diameter to the Sun's at the ground
   *  point — the canons' eclipse magnitude. >1 total, <1 annular. NaN
   *  when the axis misses Earth. */
  magnitude: number;
}

/** The Moon's shadow on Earth at `t`. */
export function solarEclipseAt(t: number): SolarEclipse {
  const { earth, moon } = earthAndRetardedMoon(t);
  const missPc = shadowAxisMiss(SUN, moon, earth);
  const result: SolarEclipse = {
    axisMissEarthRadii: missPc / EARTH_RADIUS_PC,
    ground: null,
    shadowFactor: 1,
    magnitude: NaN,
  };
  if (!shadowAxisSurfaceHit(SUN, moon, earth, EARTH_RADIUS_PC, _hit)) return result;

  // Surface point, heliocentric, and the shadow it sits in.
  const px = earth.x + _hit.x;
  const py = earth.y + _hit.y;
  const pz = earth.z + _hit.z;
  const dSun = Math.hypot(px, py, pz);
  result.shadowFactor = casterShadowFactor(
    px, py, pz,
    -px / dSun, -py / dSun, -pz / dSun,
    moon.x, moon.y, moon.z,
    MOON_RADIUS_PC,
    R_SUN_PC / dSun,
  );

  const dMoon = Math.hypot(moon.x - px, moon.y - py, moon.z - pz);
  result.magnitude = Math.asin(MOON_RADIUS_PC / dMoon) / Math.asin(R_SUN_PC / dSun);

  const icrs: Vec3 = { x: 0, y: 0, z: 0 };
  eclipticToIcrs(_hit, icrs);
  const n = Math.hypot(icrs.x, icrs.y, icrs.z);
  icrs.x /= n;
  icrs.y /= n;
  icrs.z /= n;

  const pole = poleRaDecDegAt(EARTH_ROTATION, t);
  const poleRa = pole.raDeg * DEG;
  const poleDec = pole.decDeg * DEG;
  const cosDec = Math.cos(poleDec);
  const centricLat = Math.asin(Math.max(-1, Math.min(1,
    icrs.x * cosDec * Math.cos(poleRa)
    + icrs.y * cosDec * Math.sin(poleRa)
    + icrs.z * Math.sin(poleDec),
  )));
  result.ground = {
    latDeg: planetodeticLatRad(centricLat, EARTH_FLATTENING) / DEG,
    lonEastDeg: subObserverLongitudeEastDeg(EARTH_ROTATION, t, icrs),
  };
  return result;
}

/** Instant of greatest eclipse — the axis's closest approach to Earth's
 *  centre — within `halfWindowS` of `tGuess`, to `toleranceS`. */
export function findGreatestSolarEclipse(
  tGuess: number,
  halfWindowS = 7200,
  toleranceS = 0.5,
): number {
  return argMin(
    (t) => solarEclipseAt(t).axisMissEarthRadii,
    tGuess - halfWindowS,
    tGuess + halfWindowS,
    60,
    toleranceS,
  );
}

/** Earth's shadow enlargement for the atmosphere. The eclipse canons
 *  apply ~2 %; the geometric cone alone reads ~0.03 magnitudes shallow
 *  against them, which is a convention difference and not a model error. */
export const CANON_SHADOW_ENLARGEMENT = 1.02;

export interface LunarEclipse {
  /** Fraction of the Moon's diameter inside Earth's umbra: ≥1 total,
   *  ≤0 outside it. */
  umbralMagnitude: number;
  /** Distance from the Moon's centre to Earth's shadow axis, parsecs. */
  axisMissPc: number;
}

/** The Moon's immersion in Earth's shadow at `t`. */
export function lunarEclipseAt(
  t: number,
  shadowEnlargement = CANON_SHADOW_ENLARGEMENT,
): LunarEclipse {
  // Symmetric to the solar case: the shadow reaching the Moon now left
  // Earth one light time ago, so the Moon is current and Earth retarded.
  const now = earthMoonAt(t);
  const moon = now.moon;
  const earth = earthMoonAt(t - earthMoonLightTimeS(now)).earth;
  const axisMissPc = shadowAxisMiss(SUN, earth, moon);
  // Along-axis distance of the Moon behind Earth.
  const sunDist = Math.hypot(earth.x, earth.y, earth.z);
  const ux = earth.x / sunDist;
  const uy = earth.y / sunDist;
  const uz = earth.z / sunDist;
  const axialDist = (moon.x - earth.x) * ux + (moon.y - earth.y) * uy + (moon.z - earth.z) * uz;
  return {
    umbralMagnitude: umbralMagnitude(
      axialDist,
      axisMissPc,
      MOON_RADIUS_PC,
      EARTH_RADIUS_PC,
      R_SUN_PC,
      sunDist,
      shadowEnlargement,
    ),
    axisMissPc,
  };
}

/** Instant of greatest lunar eclipse within `halfWindowS` of `tGuess`. */
export function findGreatestLunarEclipse(
  tGuess: number,
  halfWindowS = 7200,
  toleranceS = 0.5,
): number {
  return argMin(
    (t) => lunarEclipseAt(t).axisMissPc,
    tGuess - halfWindowS,
    tGuess + halfWindowS,
    60,
    toleranceS,
  );
}

/** Sun–Earth distance in AU at `t` — the canons' own sanity column. */
export function sunEarthDistanceAu(t: number): number {
  const { earth } = earthMoonAt(t);
  return Math.hypot(earth.x, earth.y, earth.z) * AU_PER_PC;
}
