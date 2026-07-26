// Heliocentric ecliptic positions for the nine planets at any wall-clock
// `t` (Unix-seconds), from the frozen Horizons element tables where they
// reach and the Standish series elsewhere. See README.md § Planet ephemeris.

import { AU_PC, DAYS_PER_JULIAN_YEAR, J2000_JD } from '../../util/astronomy-constants';
import { orbitalStateToCartesian } from '../../util/kepler-solver';
import { tToJdTdb } from '../time/time';
import { elementTableSampleAt, type PlanetElementTable } from './element-table';
import {
  blendEquinoctialInto,
  equinoctialFromAngles,
  equinoctialToClassical,
  makeClassical,
  makeEquinoctial,
  type EquinoctialElements,
} from './equinoctial-pure';

const DEG = Math.PI / 180;
const DAYS_PER_JULIAN_CENTURY = 36525;

// JPL Table 2a — J2000 mean elements + Julian-century rates. Angles in
// degrees / deg-per-century; semi-major axis in AU. EM Bary stands in
// for Earth at this approximation level (sub-arcsec offset between Earth
// and EM-Bary is irrelevant at pixel scale).
interface ElementSet {
  a: number;  aDot: number;  // semi-major axis (AU)
  e: number;  eDot: number;  // eccentricity
  I: number;  IDot: number;  // inclination (deg)
  L: number;  LDot: number;  // mean longitude (deg)
  // longitude of perihelion ϖ = ω + Ω (deg)
  longperi: number;  longperiDot: number;
  // longitude of ascending node Ω (deg)
  longnode: number;  longnodeDot: number;
  // Cubic Jupiter–Pluto perturbation terms for the mean anomaly. Zero
  // for inner planets — the (b·T² + c·cos(fT) + s·sin(fT)) correction is
  // a numerical patch for the linear-elements model's blind spots near
  // mean-motion resonances (Jupiter–Saturn, Uranus–Neptune, Neptune–Pluto).
  b: number; c: number; s: number; f: number;
}

// Order matches PlanetName below — getPlanetPositions returns a same-
// order tuple so the renderer (planet-body-field.ts) can iterate without a
// per-frame name lookup.
const ELEMENTS: ElementSet[] = [
  // Mercury
  {
    a: 0.38709843,    aDot:  0.00000000,
    e: 0.20563661,    eDot:  0.00002123,
    I: 7.00559432,    IDot: -0.00590158,
    L: 252.25166724,  LDot:  149472.67486623,
    longperi: 77.45771895,    longperiDot: 0.15940013,
    longnode: 48.33961819,    longnodeDot: -0.12214182,
    b: 0, c: 0, s: 0, f: 0,
  },
  // Venus
  {
    a: 0.72332102,    aDot: -0.00000026,
    e: 0.00676399,    eDot: -0.00005107,
    I: 3.39777545,    IDot:  0.00043494,
    L: 181.97970850,  LDot:  58517.81560260,
    longperi: 131.76755713,   longperiDot: 0.05679648,
    longnode: 76.67261496,    longnodeDot: -0.27274174,
    b: 0, c: 0, s: 0, f: 0,
  },
  // Earth (EM Bary)
  {
    a: 1.00000018,    aDot: -0.00000003,
    e: 0.01673163,    eDot: -0.00003661,
    I: -0.00054346,   IDot: -0.01337178,
    L: 100.46691572,  LDot:  35999.37306329,
    longperi: 102.93005885,   longperiDot: 0.31795260,
    longnode: -5.11260389,    longnodeDot: -0.24123856,
    b: 0, c: 0, s: 0, f: 0,
  },
  // Mars
  {
    a: 1.52371243,    aDot:  0.00000097,
    e: 0.09336511,    eDot:  0.00009149,
    I: 1.85181869,    IDot: -0.00724757,
    L: -4.56813164,   LDot:  19140.29934243,
    longperi: -23.91744784,   longperiDot: 0.45223625,
    longnode: 49.71320984,    longnodeDot: -0.26852431,
    b: 0, c: 0, s: 0, f: 0,
  },
  // Jupiter
  {
    a: 5.20248019,    aDot: -0.00002864,
    e: 0.04853590,    eDot:  0.00018026,
    I: 1.29861416,    IDot: -0.00322699,
    L: 34.33479152,   LDot:  3034.90371757,
    longperi: 14.27495244,    longperiDot: 0.18199196,
    longnode: 100.29282654,   longnodeDot: 0.13024619,
    b: -0.00012452, c: 0.06064060, s: -0.35635438, f: 38.35125000,
  },
  // Saturn
  {
    a: 9.54149883,    aDot: -0.00003065,
    e: 0.05550825,    eDot: -0.00032044,
    I: 2.49424102,    IDot:  0.00451969,
    L: 50.07571329,   LDot:  1222.11494724,
    longperi: 92.86136063,    longperiDot: 0.54179478,
    longnode: 113.63998702,   longnodeDot: -0.25015002,
    b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125000,
  },
  // Uranus
  {
    a: 19.18797948,   aDot: -0.00020455,
    e: 0.04685740,    eDot: -0.00001550,
    I: 0.77298127,    IDot: -0.00180155,
    L: 314.20276625,  LDot:  428.49512595,
    longperi: 172.43404441,   longperiDot: 0.09266985,
    longnode: 73.96250215,    longnodeDot: 0.05739699,
    b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025000,
  },
  // Neptune
  {
    a: 30.06952752,   aDot:  0.00006447,
    e: 0.00895439,    eDot:  0.00000818,
    I: 1.77005520,    IDot:  0.00022400,
    L: 304.22289287,  LDot:  218.46515314,
    longperi: 46.68158724,    longperiDot: 0.01009938,
    longnode: 131.78635853,   longnodeDot: -0.00606302,
    b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025000,
  },
  // Pluto. JPL removed Pluto from approx_pos.html at the IAU
  // reclassification; this is the pre-removal Table 2a row plus its
  // Table 2b b term, valid over the same 3000 BC – 3000 AD window the
  // model clock spans. The widely reproduced Standish & Williams
  // linear-elements row is a few-centuries fit that reaches tens of AU
  // of error at the clamp bound — do not substitute it.
  {
    a: 39.48686035,   aDot:  0.00449751,
    e: 0.24885238,    eDot:  0.00006016,
    I: 17.14104260,   IDot:  0.00000501,
    L: 238.96535011,  LDot:  145.18042903,
    longperi: 224.09702598,   longperiDot: -0.00968827,
    longnode: 110.30167986,   longnodeDot: -0.00809981,
    b: -0.01262724, c: 0, s: 0, f: 0,
  },
];

export type PlanetName =
  | 'mercury' | 'venus' | 'earth' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune'
  | 'pluto';

export const PLANET_ORDER: readonly PlanetName[] = [
  'mercury', 'venus', 'earth', 'mars',
  'jupiter', 'saturn', 'uranus', 'neptune',
  'pluto',
];

export interface Vec3 { x: number; y: number; z: number; }

export type PlanetPositions = Record<PlanetName, Vec3>;

// Cache: keyed on exact `t`, holds the same PlanetPositions object
// reference across same-`t` calls. Single-slot — planet positions are
// only ever queried for one `t` per frame, so this collapses the
// several per-frame consumers (body field, focal ride, overlays) into
// one Kepler solve without quantising motion across frames. The former
// 60-second bucket was reasoned against billboarded-disc pixel scale;
// mesh-LOD close viewing (resolved discs at planet zoom) made the
// bucket's position snap visible, so recompute follows `t` exactly.
let cachedT: number | null = null;
let cachedPositions: PlanetPositions | null = null;

/** Standish elements at centuries-past-J2000 `T`, in the equinoctial form
 *  every element source here is expressed in. The b/c/s/f correction lands on
 *  the mean longitude directly: Standish's M = L − ϖ + (b·T² + c·cos fT +
 *  s·sin fT), so λ = M + ϖ is L plus the same correction. */
export function standishEquinoctialAt(
  elem: ElementSet,
  T: number,
  out: EquinoctialElements,
): void {
  const fT = elem.f * T * DEG;
  equinoctialFromAngles(
    elem.a + elem.aDot * T,
    elem.e + elem.eDot * T,
    elem.I + elem.IDot * T,
    elem.longnode + elem.longnodeDot * T,
    elem.longperi + elem.longperiDot * T,
    elem.L + elem.LDot * T
      + elem.b * T * T
      + elem.c * Math.cos(fT)
      + elem.s * Math.sin(fT),
    out,
  );
}

/** Heliocentric ecliptic position (AU) of a single planet from its Standish
 *  row alone at centuries-past-J2000 `T`, with no element table and no seam.
 *  Pure helper exposed for tests; the public API is `getPlanetPositions(t)`. */
export function planetEclipticAU(elem: ElementSet, T: number, out: Vec3): void {
  standishEquinoctialAt(elem, T, scratchEq);
  positionFromEquinoctial(scratchEq, out);
}

function positionFromEquinoctial(eq: EquinoctialElements, out: Vec3): void {
  equinoctialToClassical(eq, scratchClassical);
  orbitalStateToCartesian(
    scratchClassical.aAu,
    scratchClassical.e,
    scratchClassical.incRad,
    scratchClassical.nodeRad,
    scratchClassical.argPeriRad,
    scratchClassical.mRad,
    out,
  );
}

/** Element tables in PLANET_ORDER; a null slot rides the Standish series at
 *  every epoch. Populated once by `element-table-loader.ts` — until then, and
 *  in a checkout that never ran the `public/` sync, every slot is null and the
 *  ephemeris behaves exactly as it did before the tables existed. */
const tables: Array<PlanetElementTable | null> = PLANET_ORDER.map(() => null);

/** Width of the crossfade at each end of a table's span. One Julian year is
 *  long enough that scrubbing across 1900 or 2100 under planet focus never
 *  shows the 0.03–0.06 AU step between the two models, and short enough that
 *  the blend is a negligible slice of either model's validity. */
const SEAM_DAYS = DAYS_PER_JULIAN_YEAR;

/** How much of the element table to mix in at `jdTdb`: 1 through the interior,
 *  ramping to 0 at each edge of the table's span, 0 outside it. */
function tableWeight(table: PlanetElementTable, jdTdb: number): number {
  if (jdTdb <= table.jd0 || jdTdb >= table.jdLast) return 0;
  return Math.min(1, (jdTdb - table.jd0) / SEAM_DAYS, (table.jdLast - jdTdb) / SEAM_DAYS);
}

/**
 * The elements one planet is positioned from at `jdTdb`: the frozen Horizons
 * table inside its span, the Standish series outside it, and a blend of the
 * two across `SEAM_DAYS` at each edge.
 *
 * Blending in equinoctial space rather than blending two positions is what
 * keeps `getPlanetPositions` and `getPlanetOrbitShapes` consistent through the
 * seam by construction — both read this one evaluation, so a ring cannot
 * drift off its body there.
 */
function planetEquinoctialAt(
  index: number,
  jdTdb: number,
  out: EquinoctialElements,
): void {
  const T = (jdTdb - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  standishEquinoctialAt(ELEMENTS[index], T, out);
  const table = tables[index];
  if (table === null) return;
  const w = tableWeight(table, jdTdb);
  if (w === 0) return;
  if (!elementTableSampleAt(table, jdTdb, scratchTableEq)) return;
  blendEquinoctialInto(out, scratchTableEq, w, out);
}

/** Install the loaded element tables. Resets the per-`t` cache: the swap moves
 *  the outer planets by up to 0.06 AU and a stale entry would hold the
 *  pre-table position for the rest of the frame it landed in. */
export function installPlanetElementTables(
  loaded: ReadonlyMap<PlanetName, PlanetElementTable>,
): void {
  PLANET_ORDER.forEach((name, i) => {
    tables[i] = loaded.get(name) ?? null;
  });
  _resetCacheForTests();
}

const scratchEq = makeEquinoctial();
const scratchTableEq = makeEquinoctial();
const scratchClassical = makeClassical();

/** Heliocentric ecliptic positions (parsecs) of the nine planets at
 *  Unix-seconds `t`. Returned object is cached per exact `t` — repeat
 *  calls within a frame get the same reference; any `t` advance
 *  recomputes. */
export function getPlanetPositions(t: number): PlanetPositions {
  if (cachedT === t && cachedPositions !== null) {
    return cachedPositions;
  }
  const jdTdb = tToJdTdb(t);
  const out = {} as PlanetPositions;
  const tmp: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < ELEMENTS.length; i++) {
    planetEquinoctialAt(i, jdTdb, scratchEq);
    positionFromEquinoctial(scratchEq, tmp);
    out[PLANET_ORDER[i]] = {
      x: tmp.x * AU_PC,
      y: tmp.y * AU_PC,
      z: tmp.z * AU_PC,
    };
  }
  cachedT = t;
  cachedPositions = out;
  return out;
}

/** Per-planet orbital-frame orientation, expressed as the three Euler
 *  angles that rotate the canonical in-plane ellipse (perihelion at +x,
 *  z=0) into the ecliptic frame. The composition is Rz(Ω)·Rx(I)·Rz(ω)
 *  — same as `planetEclipticAU` applies to the in-plane (x', y'). */
export interface OrbitOrientationRad {
  /** Inclination from the ecliptic (radians), always ≥ 0 — see
   *  `equinoctialToClassical` on what that costs a near-coplanar orbit. */
  inclination: number;
  /** Longitude of ascending node Ω (radians). */
  longAscNode: number;
  /** Argument of perihelion ω = ϖ − Ω (radians). */
  argPerihelion: number;
}

/** One planet's orbit-ring geometry: secular-rate-applied a/e plus the
 *  Rz(Ω)·Rx(I)·Rz(ω) orientation. */
export interface PlanetOrbitShape {
  readonly aAu: number;
  readonly e: number;
  readonly orientation: OrbitOrientationRad;
}

/** Per-planet orbit shapes at Unix-seconds `t`, in PLANET_ORDER — from the
 *  SAME evaluated elements `getPlanetPositions` positions the body with,
 *  element table and seam blend included, so a ring built from a shape passes
 *  through its body by construction at every `t`. The former attach-time
 *  snapshot desynced under time scrubbing, and its ring a/e came from a
 *  second, rounded table. */
export function getPlanetOrbitShapes(t: number): PlanetOrbitShape[] {
  const jdTdb = tToJdTdb(t);
  const out: PlanetOrbitShape[] = [];
  for (let i = 0; i < ELEMENTS.length; i++) {
    planetEquinoctialAt(i, jdTdb, scratchEq);
    equinoctialToClassical(scratchEq, scratchClassical);
    out.push({
      aAu: scratchClassical.aAu,
      e: scratchClassical.e,
      orientation: {
        inclination: scratchClassical.incRad,
        longAscNode: scratchClassical.nodeRad,
        argPerihelion: scratchClassical.argPeriRad,
      },
    });
  }
  return out;
}

/** Reset the per-`t` cache. Test-only — production callers never need
 *  this; the cache invalidates naturally as `t` advances. */
export function _resetCacheForTests(): void {
  cachedT = null;
  cachedPositions = null;
}

export type { ElementSet };
export { ELEMENTS, J2000_JD };
