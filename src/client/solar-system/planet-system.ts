// Planet / PlanetSystem contract + SOL_PLANETS table. Generic across
// hosts; gating is via Stellata.getFocusedPlanetSystem(). See
// src/client/solar-system/README.md § Data model.

import type { Catalog } from '../loaders/catalog-loader';
import { AU_KM } from '../util/astronomy-constants';
import {
  getPlanetOrbitShapes,
  getPlanetPositions,
  PLANET_ORDER,
  type OrbitOrientationRad,
  type PlanetName,
  type Vec3,
} from './ephemerides/ephemeris';
import {
  earthMoonSplit,
  MOON_ELEMENTS,
  moonOffsetEcliptic,
  type MoonElements,
} from './ephemerides/moon-ephemeris';
import {
  EARTH_PHASE,
  JUPITER_PHASE,
  MARS_PHASE,
  MERCURY_PHASE,
  type PhaseCoefficients,
  SATURN_PHASE,
  VENUS_PHASE,
} from './phase-function';
import {
  EARTH_ROTATION,
  JUPITER_ROTATION,
  MARS_ROTATION,
  MERCURY_ROTATION,
  MOON_ROTATION_BY_NAME,
  NEPTUNE_ROTATION,
  PLUTO_ROTATION,
  type RotationElements,
  SATURN_ROTATION,
  URANUS_ROTATION,
  VENUS_ROTATION,
} from './planets/rotation/rotation-elements-pure';

export type PlanetType = 'rocky' | 'gas_giant' | 'ice_giant' | 'icy';

export interface Planet {
  readonly name: string;
  // Equatorial radius in km. Conversion to parsecs (for `θ = 2·atan(R/d)`
  // disc sizing) is the renderer's responsibility — keep the canonical
  // unit human-readable here.
  readonly radiusKm: number;
  // Polar flattening f = (R_eq − R_pol) / R_eq, NASA fact sheets.
  // Omitted = spherical; the mesh renderer scales its polar axis by
  // (1 − f).
  readonly flattening?: number;
  // Standard gravitational parameter GM (km³/s²). Carried by bodies that
  // parent a moon; the moon's orbital period follows from its parent's GM
  // (Kepler III), not the host star's, so a moon's focus-card period row
  // reads this rather than assuming solar mass.
  readonly gravParamGM?: number;
  // Display-only approximate semi-major axis (AU) and eccentricity:
  // cull proxies, focus-card rows, placeholder layouts. Rendered ring
  // geometry and body positions come from the live element source
  // (`orbitGeometryAt` / `positionsAt`), never these fields — the two
  // tables were once unreconciled and rings visibly missed their
  // bodies (Mercury by ~6 body radii at J2000).
  readonly semiMajorAxisAu: number;
  readonly eccentricity: number;
  readonly type: PlanetType;
  // Parent body's `name` when this body orbits a planet rather than the
  // host star (a moon). Presence flips position composition, orbit-ring
  // centring, and the focus-card breadcrumb from host-star to this parent;
  // absence ⇒ the body orbits the host star directly.
  readonly parentName?: string;
  // Representative single-colour RGB in linear-ish [0,1]. Average tones
  // only — atmospheric scattering, banding, and surface texturing all
  // depend on a future planet-selection / close-zoom affordance that
  // doesn't exist yet, so per-planet appearance refinements are
  // deferred until that lands.
  readonly colour: readonly [number, number, number];
  // Geometric albedo (V-band). Drives the apparent-magnitude
 // calculation in the planet pipeline. Mallama 2018 +
  // NASA fact-sheet values.
  readonly albedo: number;
  // Optional Mallama 2018 empirical phase-curve coefficients —
  // overrides the default Lambertian phase function in the renderer
  // when present. See `phase-function.ts` for the polynomial form
  // and per-planet citations. Pluto and every exoplanet under
  // the exoplanet epic leave this undefined and fall back to Lambert.
  readonly phaseCoefficients?: PhaseCoefficients;
  // Optional IAU rotation elements (pole + prime meridian on the model
  // clock). Bodies without published elements leave this undefined —
  // the mesh renderer falls back to pole = host orbital-plane normal
  // with an arbitrary fixed meridian, the same convention shape as the
  // Lambertian phase fallback.
  readonly rotation?: RotationElements;
  // Mesh-terminator softness half-width on dot(n, sunDir) — how far
  // atmospheric scattering carries light past the geometric terminator.
  // Undefined = 0 = airless hard cut. Perceptual seeds tuned at smoke,
  // scaled to atmosphere density (Venus thickest).
  readonly terminatorSoftness?: number;
  // Optional ring system: annulus span in the body's equatorial
  // plane, textured by the `<body>-rings.png` radial strip (RGB =
  // colour, A = opacity; U maps inner→outer). Spans must match the
  // strip builds in scripts/textures/build-textures.py — see
  // data/textures/README.md § Ring strips (Jupiter's rings ship no
  // strip: below the 8-bit-representable opacity floor).
  readonly rings?: PlanetRings;
  // Optional atmosphere shell (mesh-LOD regime only): day-side limb
  // glow + back-lit forward-scatter halo. Gas giants deliberately
  // carry none — see src/client/solar-system/README.md § Atmospheres.
  readonly atmosphere?: PlanetAtmosphere;
}

export interface PlanetAtmosphere {
  /** Visible shell height above the surface, km — the TRUE scattering
   *  extent (Kármán-line scale for Earth, haze-top for Venus/Titan),
   *  never an exaggerated art value. Sets the integration extent. */
  readonly heightKm: number;
  /** Rayleigh (molecular) scale height, km. */
  readonly rayleighHeightKm: number;
  /** Mie (aerosol) scale height, km — also the absorption profile. */
  readonly mieHeightKm: number;
  /** Rayleigh scatter coefficient per channel, as a vertical optical depth
   *  (1/λ⁴ shape → blue). Earth's blue sky; a near-zero molecular column on
   *  dust-dominated Mars. */
  readonly rayleighCoeff: readonly [number, number, number];
  /** Grey Mie (aerosol) scatter coefficient, vertical optical depth. */
  readonly mieCoeff: number;
  /** Aerosol absorption per channel, vertical optical depth — the hue
   *  source a grey-Mie model cannot give: blue removed → Titan orange,
   *  Mars butterscotch, Venus pale yellow. */
  readonly absorbCoeff: readonly [number, number, number];
  /** Henyey-Greenstein forward asymmetry; default MIE_G_DEFAULT (0.76). */
  readonly mieG?: number;
  /** Illuminant colour; default SUN_COLOUR (Sol warm-white). */
  readonly sunColour?: readonly [number, number, number];
}

export interface PlanetRings {
  /** Inner/outer edge of the textured annulus, km from body centre. */
  readonly innerRadiusKm: number;
  readonly outerRadiusKm: number;
}

export interface PlanetSystem {
  // Catalog index of the host star. Stable for as long as the loaded
  // catalog instance is alive.
  readonly hostStarIdx: number;
  readonly planets: readonly Planet[];
  /** Optional time-evolved position resolver. When present, the
   *  renderer (`planet-body-field.ts`) calls it each frame to refresh body
   *  positions; when absent, the renderer falls back to the static
   *  placeholder eccentric-anomaly layout from `placeholderEccentricAnomaly`.
   *
   *  Writes 3 doubles per planet (xyz triples in the host's local
   *  orbital-plane frame: x/y in-plane, z perpendicular) into `out`,
   *  in `planets` array order. Units: parsecs. The renderer applies
   *  the per-host orbital-plane orientation quaternion downstream to
   *  rotate into ICRS — Sol's ecliptic frame becomes ICRS via the
   *  same quaternion that orients its orbit rings.
   *
   *  Float64Array, not Float32Array: at Pluto's 39.5 AU a float32
   *  parsec quantises to 449 km — 0.38 of Pluto's own radius, and this
   *  buffer feeds the mesh LOD, focus ride, and overlay projections,
   *  not just the GPU attribute. See `planets/README.md` § Position
   *  precision. */
  positionsAt?: (t: number, out: Float64Array) => void;
  /** Optional live orbit-ring geometry, indexed parallel to `planets`,
   *  from the SAME element source `positionsAt` evaluates — so a ring
   *  built from it passes through its body at every model time. When
   *  absent the ring layer falls back to `defaultOrbitGeometry`
   *  (static Planet a/e, flat on the host plane, perihelion at +x). */
  orbitGeometryAt?: (t: number) => readonly BodyOrbitGeometry[];
}

/** Parent-relative Keplerian ring geometry for one body — the orbit-
 *  ring layer's build input. */
export interface BodyOrbitGeometry {
  readonly aAu: number;
  readonly e: number;
  /** Rz(Ω)·Rx(I)·Rz(ω) in the body's element reference frame. */
  readonly orientation: OrbitOrientationRad;
  /** ICRS pole of the element reference plane when it is not the host
   *  plane (a moon's Laplace / parent-equatorial plane). Omitted ⇒ the
   *  elements are already host-plane-referenced (planets: ecliptic;
   *  the Moon too). */
  readonly refPoleRaDeg?: number;
  readonly refPoleDecDeg?: number;
  /** Index into `planets` of the centre body a moon orbits; null ⇒
   *  the body orbits the host star. */
  readonly parentIdx: number | null;
}

const ZERO_ORIENTATION: OrbitOrientationRad = {
  inclination: 0,
  longAscNode: 0,
  argPerihelion: 0,
};

/** Ring-geometry fallback for hosts without a live element source
 *  (future exoplanet shards): static Planet a/e, flat on the host
 *  plane, perihelion at +x; a moon resolves its parent by name. */
export function defaultOrbitGeometry(
  planets: readonly Planet[],
): BodyOrbitGeometry[] {
  return planets.map((p) => {
    const parentIdx = p.parentName
      ? planets.findIndex((q) => q.name === p.parentName)
      : -1;
    return {
      aAu: p.semiMajorAxisAu,
      e: p.eccentricity,
      orientation: ZERO_ORIENTATION,
      parentIdx: parentIdx >= 0 ? parentIdx : null,
    };
  });
}

/** Sol's positionsAt — heliocentric ecliptic positions in parsecs, in
 *  SOL_BODIES order: the nine planets (PLANET_ORDER) first, then the 18
 *  moons (SOL_MOONS order). Each moon is `parent_ecliptic +
 *  moonOffsetEcliptic`; the Earth slot and the Moon slot are jointly
 *  resolved from the Standish EM-barycentre via `earthMoonSplit`, so
 *  Earth sits ~4700 km off-barycentre. The caller applies the single
 *  ecliptic→ICRS host quaternion to the whole vector, so composing the
 *  offset in the ecliptic frame here lands the moon at parent+offset in
 *  ICRS. Planet and moon Kepler solves both run at every distinct `t`
 *  (getPlanetPositions memoises same-`t` repeat calls only). */
function solPositionsAt(t: number, out: Float64Array): void {
  const positions = getPlanetPositions(t);
  const planetCount = PLANET_ORDER.length;
  for (let i = 0; i < planetCount; i++) {
    const p = positions[PLANET_ORDER[i]];
    out[i * 3 + 0] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  for (let j = 0; j < MOON_COMPOSE.length; j++) {
    const { elem, parent } = MOON_COMPOSE[j];
    const parentPos = positions[parent];
    moonOffsetEcliptic(elem, t, _moonOffset);
    const slot = (planetCount + j) * 3;
    if (elem.name === 'Moon') {
      earthMoonSplit(parentPos, _moonOffset, _earthCentre, _moonAbs);
      const es = EARTH_ORDER_INDEX * 3;
      out[es + 0] = _earthCentre.x;
      out[es + 1] = _earthCentre.y;
      out[es + 2] = _earthCentre.z;
      out[slot + 0] = _moonAbs.x;
      out[slot + 1] = _moonAbs.y;
      out[slot + 2] = _moonAbs.z;
    } else {
      out[slot + 0] = parentPos.x + _moonOffset.x;
      out[slot + 1] = parentPos.y + _moonOffset.y;
      out[slot + 2] = parentPos.z + _moonOffset.z;
    }
  }
}

// Sol's eight planets. Radii from NASA planetary fact sheets (equatorial).
// Semi-major axes and eccentricities from JPL DE440 mean elements at
// J2000. Colours are observation-derived representative tones — pixel-
// accurate texturing depends on the future planet-as-object epic
// clearing its design gate; for now bodies are flat-
// coloured discs.
export const SOL_PLANETS: readonly Planet[] = [
  {
    name: 'Mercury',
    radiusKm: 2440,
    semiMajorAxisAu: 0.387,
    eccentricity: 0.2056,
    type: 'rocky',
    colour: [0.55, 0.47, 0.32],
    albedo: 0.142,
    phaseCoefficients: MERCURY_PHASE,
    rotation: MERCURY_ROTATION,
  },
  {
    name: 'Venus',
    radiusKm: 6052,
    semiMajorAxisAu: 0.723,
    eccentricity: 0.0068,
    type: 'rocky',
    colour: [0.91, 0.82, 0.60],
    albedo: 0.689,
    phaseCoefficients: VENUS_PHASE,
    rotation: VENUS_ROTATION,
    terminatorSoftness: 0.08,
    // The cloud-top texture carries the visible disc; the atmosphere stays
    // optically thin over it (a limb/airlight overlay, not a second cloud
    // layer that would double-count), mild blue absorption → pale-yellow tint.
    // Rayleigh: the CO₂ column above the τ=1 cloud tops. Sources:
    // atmosphere/README.md § Calibrating per-body values.
    atmosphere: {
      heightKm: 90, rayleighHeightKm: 15.9, mieHeightKm: 5,
      rayleighCoeff: [0.0035, 0.0068, 0.0156], mieCoeff: 0.12,
      absorbCoeff: [0.003, 0.008, 0.020], mieG: 0.70,
    },
  },
  {
    name: 'Earth',
    radiusKm: 6371,
    flattening: 0.00335,
    gravParamGM: 398600.435,
    semiMajorAxisAu: 1.000,
    eccentricity: 0.0167,
    type: 'rocky',
    colour: [0.31, 0.49, 0.67],
    albedo: 0.434,
    phaseCoefficients: EARTH_PHASE,
    rotation: EARTH_ROTATION,
    terminatorSoftness: 0.05,
    // Rayleigh: sea-level τ_R at 650/550/450 nm (Bodhaine et al. 1999); the
    // Mie term is the clean maritime background aerosol column. Sources +
    // derivations: atmosphere/README.md § Calibrating per-body values.
    atmosphere: {
      heightKm: 100, rayleighHeightKm: 8, mieHeightKm: 1.2,
      rayleighCoeff: [0.049, 0.097, 0.221], mieCoeff: 0.05,
      absorbCoeff: [0, 0, 0],
    },
  },
  {
    name: 'Mars',
    radiusKm: 3390,
    flattening: 0.00589,
    semiMajorAxisAu: 1.524,
    eccentricity: 0.0934,
    type: 'rocky',
    colour: [0.76, 0.27, 0.05],
    albedo: 0.170,
    phaseCoefficients: MARS_PHASE,
    rotation: MARS_ROTATION,
    terminatorSoftness: 0.02,
    // Dust-dominated: the 6.1 hPa CO₂ column's near-zero Rayleigh, the
    // measured background dust column as grey Mie, and blue-absorbing dust
    // (measured single-scattering albedo) → butterscotch sky. Sources:
    // atmosphere/README.md § Calibrating per-body values.
    atmosphere: {
      heightKm: 60, rayleighHeightKm: 11, mieHeightKm: 11,
      rayleighCoeff: [0.0013, 0.0025, 0.0057], mieCoeff: 0.2,
      absorbCoeff: [0.006, 0.022, 0.067],
    },
  },
  {
    name: 'Jupiter',
    radiusKm: 69911,
    flattening: 0.06487,
    gravParamGM: 126686534,
    semiMajorAxisAu: 5.203,
    eccentricity: 0.0485,
    type: 'gas_giant',
    colour: [0.85, 0.72, 0.51],
    albedo: 0.538,
    phaseCoefficients: JUPITER_PHASE,
    rotation: JUPITER_ROTATION,
    terminatorSoftness: 0.02,
  },
  {
    name: 'Saturn',
    radiusKm: 58232,
    flattening: 0.09796,
    gravParamGM: 37931207,
    semiMajorAxisAu: 9.537,
    eccentricity: 0.0555,
    type: 'gas_giant',
    colour: [0.90, 0.79, 0.62],
    albedo: 0.499,
    phaseCoefficients: SATURN_PHASE,
    rotation: SATURN_ROTATION,
    terminatorSoftness: 0.02,
    // Radial span of the shipped ring profile (data/textures/README.md
    // § Artifact contract) — D-ring inner edge to F-ring outer.
    rings: { innerRadiusKm: 74510, outerRadiusKm: 140390 },
  },
  // Uranus and Neptune deliberately omit `phaseCoefficients` — see
  // the comment in `phase-function.ts` for the reason. Both fall
  // back to the Lambertian phase function via the renderer's
  // alphaMaxDeg=0 sentinel, same as Pluto and every exoplanet.
  {
    name: 'Uranus',
    radiusKm: 25362,
    flattening: 0.02293,
    gravParamGM: 5793939,
    semiMajorAxisAu: 19.191,
    eccentricity: 0.0464,
    type: 'ice_giant',
    colour: [0.64, 0.85, 0.90],
    albedo: 0.488,
    rotation: URANUS_ROTATION,
    terminatorSoftness: 0.03,
    rings: { innerRadiusKm: 41600, outerRadiusKm: 51300 },
  },
  {
    name: 'Neptune',
    radiusKm: 24622,
    flattening: 0.01708,
    gravParamGM: 6836529,
    semiMajorAxisAu: 30.069,
    eccentricity: 0.0095,
    type: 'ice_giant',
    colour: [0.25, 0.37, 0.75],
    albedo: 0.442,
    rotation: NEPTUNE_ROTATION,
    terminatorSoftness: 0.03,
    rings: { innerRadiusKm: 40900, outerRadiusKm: 63100 },
  },
  // Pluto — mean radius from New Horizons 2015 reconnaissance. Type
  // 'rocky' is the closest match in our existing tri-state; Pluto is
  // really an icy-rocky body but bins with the inner terrestrials for
  // disc-rendering purposes (sharp silhouette, not a gas-giant gradient).
  // Tan-pink colour reflects New Horizons MVIC imagery. Albedo from
  // HST + New Horizons reconnaissance. No `phaseCoefficients` — Mallama
  // 2018 doesn't publish a polynomial fit for Pluto, so the renderer
  // uses the Lambertian default.
  {
    name: 'Pluto',
    radiusKm: 1188,
    semiMajorAxisAu: 39.482,
    eccentricity: 0.2488,
    type: 'rocky',
    colour: [0.78, 0.62, 0.49],
    albedo: 0.49,
    rotation: PLUTO_ROTATION,
  },
] as const;

interface MoonPhysical {
  readonly name: string;
  readonly parentName: string;
  readonly radiusKm: number;
  readonly albedo: number;
  readonly type: PlanetType;
  readonly colour: readonly [number, number, number];
  readonly terminatorSoftness?: number;
  readonly atmosphere?: PlanetAtmosphere;
}

// Physical properties for the 18 major moons. Mean radii from NASA/JPL
// fact sheets; geometric albedos and representative colours per
// docs/science-solar-system.md § Moons. Orbital a/e are NOT repeated here
// — SOL_MOONS reads them from MOON_ELEMENTS by name, so each has a single
// source of truth.
const MOON_PHYSICAL: readonly MoonPhysical[] = [
  { name: 'Moon', parentName: 'Earth', radiusKm: 1737.4, albedo: 0.12, type: 'rocky', colour: [0.55, 0.54, 0.52] },

  { name: 'Io', parentName: 'Jupiter', radiusKm: 1821.6, albedo: 0.63, type: 'rocky', colour: [0.86, 0.78, 0.45] },
  { name: 'Europa', parentName: 'Jupiter', radiusKm: 1560.8, albedo: 0.67, type: 'icy', colour: [0.82, 0.76, 0.68] },
  { name: 'Ganymede', parentName: 'Jupiter', radiusKm: 2634.1, albedo: 0.43, type: 'icy', colour: [0.58, 0.53, 0.47] },
  { name: 'Callisto', parentName: 'Jupiter', radiusKm: 2410.3, albedo: 0.22, type: 'icy', colour: [0.45, 0.41, 0.37] },

  { name: 'Mimas', parentName: 'Saturn', radiusKm: 198.2, albedo: 0.96, type: 'icy', colour: [0.72, 0.72, 0.72] },
  { name: 'Enceladus', parentName: 'Saturn', radiusKm: 252.1, albedo: 0.99, type: 'icy', colour: [0.92, 0.93, 0.95] },
  { name: 'Tethys', parentName: 'Saturn', radiusKm: 531.1, albedo: 0.80, type: 'icy', colour: [0.80, 0.80, 0.80] },
  { name: 'Dione', parentName: 'Saturn', radiusKm: 561.4, albedo: 0.70, type: 'icy', colour: [0.75, 0.75, 0.74] },
  { name: 'Rhea', parentName: 'Saturn', radiusKm: 763.8, albedo: 0.95, type: 'icy', colour: [0.78, 0.78, 0.77] },
  // Titan is the one moon with a dense atmosphere (1.5 bar N2 haze) —
  // Earth-like terminator softness; every other in-scope moon is airless.
  // Its detached haze layers extend ~300 km above the surface —
  // proportionally the largest shell of the four atmosphere bodies
  // (~12 % of R); the famous Cassini back-lit ring.
  { name: 'Titan', parentName: 'Saturn', radiusKm: 2574.7, albedo: 0.22, type: 'icy', colour: [0.83, 0.60, 0.28],
    terminatorSoftness: 0.05,
    // Thick tholin haze: strong grey Mie scatter, strongly forward (Cassini
    // back-lit ring), and heavy blue absorption (high-in-blue absorbCoeff)
    // → orange. Do not invert the absorption channels.
    // Unlike the others, Titan's haze is OPTICALLY THICK in visible light —
    // the surface is invisible, so the atmosphere is deliberately dense
    // enough to hide the (near-IR) texture and read as a featureless orange
    // ball: strong grey Mie scatter + heavy blue absorption. Independent of
    // the other bodies (per-row params); do not invert the absorption.
    // Rayleigh: the full 1.5-bar N₂ column, ~11x Earth's — mostly hidden
    // beneath the absorbing haze, but its top is Titan's real high-altitude
    // blue limb. Sources: atmosphere/README.md § Calibrating per-body values.
    atmosphere: {
      heightKm: 300, rayleighHeightKm: 40, mieHeightKm: 50,
      rayleighCoeff: [0.51, 1.01, 2.31], mieCoeff: 2.5,
      absorbCoeff: [0.15, 0.6, 1.4], mieG: 0.80,
    } },
  { name: 'Iapetus', parentName: 'Saturn', radiusKm: 734.5, albedo: 0.25, type: 'icy', colour: [0.42, 0.35, 0.28] },

  { name: 'Miranda', parentName: 'Uranus', radiusKm: 235.8, albedo: 0.32, type: 'icy', colour: [0.62, 0.62, 0.63] },
  { name: 'Ariel', parentName: 'Uranus', radiusKm: 578.9, albedo: 0.39, type: 'icy', colour: [0.66, 0.66, 0.66] },
  { name: 'Umbriel', parentName: 'Uranus', radiusKm: 584.7, albedo: 0.21, type: 'icy', colour: [0.45, 0.45, 0.46] },
  { name: 'Titania', parentName: 'Uranus', radiusKm: 788.4, albedo: 0.27, type: 'icy', colour: [0.58, 0.55, 0.53] },
  { name: 'Oberon', parentName: 'Uranus', radiusKm: 761.4, albedo: 0.23, type: 'icy', colour: [0.55, 0.50, 0.47] },

  { name: 'Triton', parentName: 'Neptune', radiusKm: 1353.4, albedo: 0.76, type: 'icy', colour: [0.85, 0.80, 0.76] },
] as const;

const MOON_ELEMENTS_BY_NAME = new Map(MOON_ELEMENTS.map((m) => [m.name, m]));

// The 18 major moons as `Planet` entries. Concatenated after SOL_PLANETS
// into SOL_BODIES (the runtime body list); solPositionsAt composes their
// heliocentric positions so they inherit the field / mesh / interaction
// stack as ordinary bodies. `semiMajorAxisAu` is parent-relative, for the
// field's cull and ring bookkeeping — real positions come from the
// resolver, never this field, the same contract planets follow.
export const SOL_MOONS: readonly Planet[] = MOON_PHYSICAL.map((m) => {
  const el = MOON_ELEMENTS_BY_NAME.get(m.name);
  if (!el) throw new Error(`SOL_MOONS: no orbital elements for ${m.name}`);
  return {
    name: m.name,
    parentName: m.parentName,
    radiusKm: m.radiusKm,
    semiMajorAxisAu: el.aKm / AU_KM,
    eccentricity: el.e,
    type: m.type,
    albedo: m.albedo,
    colour: m.colour,
    terminatorSoftness: m.terminatorSoftness,
    rotation: MOON_ROTATION_BY_NAME.get(m.name),
    atmosphere: m.atmosphere,
  };
});

// Sol's runtime body list: the nine planets followed by the 18 moons.
// One array so the body field, mesh layer, and every interaction contract
// iterate a single stream — a moon is just another entry. Position
// composition (solPositionsAt) writes this exact order.
export const SOL_BODIES: readonly Planet[] = [...SOL_PLANETS, ...SOL_MOONS];

// Per-moon composition inputs in SOL_MOONS order, so solPositionsAt walks
// them by flat slot without a per-frame map lookup. `parent` is the
// PlanetName key into the ephemeris position table.
interface MoonCompose {
  readonly elem: MoonElements;
  readonly parent: PlanetName;
}
const EARTH_ORDER_INDEX = PLANET_ORDER.indexOf('earth');
const MOON_COMPOSE: readonly MoonCompose[] = SOL_MOONS.map((m) => {
  const elem = MOON_ELEMENTS_BY_NAME.get(m.name);
  if (!elem) throw new Error(`MOON_COMPOSE: no orbital elements for ${m.name}`);
  return { elem, parent: elem.parent.toLowerCase() as PlanetName };
});

const _moonOffset: Vec3 = { x: 0, y: 0, z: 0 };
const _earthCentre: Vec3 = { x: 0, y: 0, z: 0 };
const _moonAbs: Vec3 = { x: 0, y: 0, z: 0 };

const DEG = Math.PI / 180;

/** Sol's orbitGeometryAt — planets from the live Standish elements
 *  (secular a/e + orientation at `t`), moons from MOON_ELEMENTS (J2000
 *  osculating, no secular terms — constant in `t`, matching the
 *  resolver that positions them), in SOL_BODIES order. */
export function solOrbitGeometryAt(t: number): BodyOrbitGeometry[] {
  const out: BodyOrbitGeometry[] = getPlanetOrbitShapes(t).map((s) => ({
    ...s,
    parentIdx: null,
  }));
  for (const { elem, parent } of MOON_COMPOSE) {
    out.push({
      aAu: elem.aKm / AU_KM,
      e: elem.e,
      orientation: {
        inclination: elem.incDeg * DEG,
        longAscNode: elem.nodeDeg * DEG,
        argPerihelion: elem.periDeg * DEG,
      },
      refPoleRaDeg: elem.refPoleRaDeg,
      refPoleDecDeg: elem.refPoleDecDeg,
      parentIdx: PLANET_ORDER.indexOf(parent),
    });
  }
  return out;
}

/** Parent/children index maps for a system's body list. */
export interface SystemFamily {
  /** Per body: index of its parent in `planets`, or -1 (orbits the host). */
  readonly parentIdx: Int32Array;
  /** Per body: indices of its moons in `planets` (empty when none). */
  readonly childIdxs: readonly (readonly number[])[];
}

// Memoised on the planets-array identity, which is stable for a session
// (SOL_BODIES; one lazily-built shard per future exoplanet host).
const familyCache = new WeakMap<readonly Planet[], SystemFamily>();

/** Parent/children maps for `planets` — moon↔parent resolution for
 *  shadow casters, membership rosters, and ring extents. */
export function systemFamily(planets: readonly Planet[]): SystemFamily {
  let family = familyCache.get(planets);
  if (family) return family;
  const indexByName = new Map(planets.map((p, i) => [p.name, i]));
  const parentIdx = new Int32Array(planets.length).fill(-1);
  const childIdxs: number[][] = planets.map(() => []);
  for (let i = 0; i < planets.length; i++) {
    const parentName = planets[i].parentName;
    if (!parentName) continue;
    const p = indexByName.get(parentName);
    if (p === undefined) continue;
    parentIdx[i] = p;
    childIdxs[p].push(i);
  }
  family = { parentIdx, childIdxs };
  familyCache.set(planets, family);
  return family;
}

/** Names of `planets[planetIdx]`'s moons in array (semi-major-axis)
 *  order — the card-roster feed. Empty for moons and moonless bodies. */
export function moonNamesOf(
  planets: readonly Planet[],
  planetIdx: number,
): string[] {
  return systemFamily(planets).childIdxs[planetIdx].map((i) => planets[i].name);
}

// Sync probe — does this star have a planet system at all?
//
// Currently hardwires "planets ⇔ Sol". When the exoplanet epic lands an
// exoplanet flag bit on the catalog record, this becomes a flag check;
// callers stay unchanged.
export function hasPlanets(catalog: Catalog, starIdx: number | null): boolean {
  if (starIdx === null || starIdx < 0) return false;
  return starIdx === catalog.solIndex;
}

// Async resolver — supplies the `PlanetSystem` for `starIdx`, or null if
// the star has no planets. Sol resolves with already-in-memory data;
// the exoplanet epic is expected to extend this to fetch a per-star JSON
// shard lazily, caching by index. The Promise wrapper keeps the API
// stable across that transition.
export async function getPlanetSystem(
  catalog: Catalog,
  starIdx: number | null,
): Promise<PlanetSystem | null> {
  if (!hasPlanets(catalog, starIdx)) return null;
  return {
    hostStarIdx: starIdx as number,
    planets: SOL_BODIES,
    positionsAt: solPositionsAt,
    orbitGeometryAt: solOrbitGeometryAt,
  };
}
