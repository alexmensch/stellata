// Surface relief in the mesh shader: the tangent frame, the normal
// perturbation and the horizon lookup on it — CPU mirrors of
// ../planet-mesh.frag.glsl — plus the limb bound that stands in while loading.

/** Below this the east direction is numerically undefined and the
 *  perturbation is dropped — mirrors the guard in the GLSL. */
export const RELIEF_POLE_EPS = 1e-6;

/** Azimuths a horizon map stores, and the full-scale of the sine it encodes —
 *  `HORIZON_AZIMUTHS` / `HORIZON_SIN_RANGE` in `scripts/textures/horizon_map.py`,
 *  which `horizon-map.test.ts` pins these against. */
export const HORIZON_AZIMUTHS = 8;
export const HORIZON_SIN_RANGE = 0.4;

/** One raw channel in [0, 1] back to the skyline sine it encodes — the inverse
 *  of `encode_horizon`, shared by every reading of a horizon texel. */
export const decodeSin = (raw: number): number =>
  (raw * 2 - 1) * HORIZON_SIN_RANGE;

/** Each relief body's DEM elevation span in metres, `[lowest, highest]` above
 *  the reference sphere it is drawn at — `DEM_BODIES[…].span_m` in
 *  `scripts/textures/dem_relief.py`, which `dem-relief.test.ts` pins these
 *  against. Keyed by the body's lowercased name, like the texture map. */
export const RELIEF_ELEV_SPAN_M: Readonly<
  Record<string, readonly [number, number]>
> = {
  moon: [-9110, 10760],
  mercury: [-5380, 4480],
  mars: [-8200, 21230],
  // Earth's floor is the SEA surface, not the seabed — its DEM is clamped to
  // >= 0 at the reduction, because over water that is what is visible.
  earth: [0, 8354],
};

const limbSin = (groundRadiusM: number, summitRadiusM: number): number =>
  Math.sqrt(Math.max(0, 1 - (groundRadiusM / summitRadiusM) ** 2));

/** Floor on the taper band's width, in the same sine units. The shader feeds
 *  the pair straight to `smoothstep`, which is UNDEFINED when its two edges
 *  coincide — and they do on a body whose DEM floor is its reference sphere,
 *  since there is then no basin for a summit to stand over. Earth is that
 *  body: its elevations are clamped at the sea surface. Matches the 1e-4 the
 *  terminator's own smoothstep uses to keep the airless case a hard cut. */
const BAND_EPS = 1e-4;

/**
 * How far past the geometric terminator ground on the body can still see the
 * sun, as the sine of the solar depression: `[full, none]`.
 *
 * A normal map carries slope but no elevation, so on its own it lights a
 * sunward slope at any depression whatever. The body bounds that: the ray has
 * to graze the limb. `full` is the bound for a summit standing over ground at
 * the reference sphere, `none` the loosest configuration the DEM admits — the
 * same summit over terrain at the span's floor. Only high ground over a basin
 * is lit between them, so the term tapers there instead of cutting.
 */
export function reliefHorizonSines(
  span: readonly [number, number],
  radiusKm: number,
): [number, number] {
  const referenceM = radiusKm * 1000;
  const summitM = referenceM + span[1];
  return [
    limbSin(referenceM, summitM),
    limbSin(referenceM + span[0], summitM),
  ];
}

/**
 * The same pair as the shader's `uReliefHorizon`, with the taper band widened
 * to `BAND_EPS` if it would otherwise be empty.
 *
 * Kept separate from `reliefHorizonSines` so that stays exactly the geometry:
 * its `none` IS `sin(arccos(r_floor / r_summit))`, the identity the horizon
 * precompute's search arc is pinned against, and widening it there would quietly
 * make the fallback bound stop being the distance the precompute searches.
 */
export function reliefHorizonUniform(
  span: readonly [number, number],
  radiusKm: number,
): [number, number] {
  const [full, none] = reliefHorizonSines(span, radiusKm);
  return [full, Math.max(none, full + BAND_EPS)];
}

type Vec3 = readonly [number, number, number];

/**
 * The surface's east and north at `n`, or null where the two are undefined
 * because `n` is the pole itself. East is `cross(pole, n)`, the direction of
 * increasing longitude; north completes it.
 */
export function tangentFrame(
  n: Vec3,
  pole: Vec3,
): { east: Vec3; north: Vec3 } | null {
  const ex = pole[1] * n[2] - pole[2] * n[1];
  const ey = pole[2] * n[0] - pole[0] * n[2];
  const ez = pole[0] * n[1] - pole[1] * n[0];
  const eLen = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (eLen < RELIEF_POLE_EPS) return null;
  const east: Vec3 = [ex / eLen, ey / eLen, ez / eLen];
  return {
    east,
    north: [
      n[1] * east[2] - n[2] * east[1],
      n[2] * east[0] - n[0] * east[2],
      n[0] * east[1] - n[1] * east[0],
    ],
  };
}

/**
 * Geometric normal `n` perturbed by one texel of a `<body>-normal.webp`
 * map, all in one consistent frame (view space in the shader). `pole` is
 * the body's north pole; `enc` is the texel's raw R,G in [0, 1], carrying
 * the map's (+x east, +y north, +z out) frame —
 * `data/textures/relief/README.md` § Surface relief.
 */
export function reliefNormal(
  n: Vec3,
  pole: Vec3,
  enc: readonly [number, number],
): [number, number, number] {
  const frame = tangentFrame(n, pole);
  if (!frame) return [n[0], n[1], n[2]];
  const [eastX, eastY, eastZ] = frame.east;
  const [northX, northY, northZ] = frame.north;

  const tx = enc[0] * 2 - 1;
  const ty = enc[1] * 2 - 1;
  const tz = Math.sqrt(Math.max(1 - (tx * tx + ty * ty), 0));

  const rx = eastX * tx + northX * ty + n[0] * tz;
  const ry = eastY * tx + northY * ty + n[1] * tz;
  const rz = eastZ * tx + northZ * ty + n[2] * tz;
  const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
  return [rx / len, ry / len, rz / len];
}

/**
 * Sine of the local skyline's elevation toward a direction whose tangent-frame
 * components are `(sunE, sunN)`, from one texel's `HORIZON_AZIMUTHS` raw
 * channels in [0, 1] — the two maps' RGBA concatenated, azimuth 0 on east and
 * running toward north.
 *
 * Compare it against `dot(n, sunDir)` on the GEOMETRIC normal: a horizon is
 * measured from the ground's true local horizontal, and the perturbed normal
 * is the facet's own slope, which this term is composed with rather than
 * duplicating (README.md § Two occluders).
 */
export function horizonSin(
  enc: readonly number[],
  sunE: number,
  sunN: number,
): number {
  const turn = Math.atan2(sunN, sunE) / (2 * Math.PI);
  const slot = (turn - Math.floor(turn)) * HORIZON_AZIMUTHS;
  const base = Math.floor(slot);
  const i0 = base % HORIZON_AZIMUTHS;
  const i1 = (i0 + 1) % HORIZON_AZIMUTHS;
  const f = slot - base;
  return decodeSin(enc[i0] * (1 - f) + enc[i1] * f);
}

/**
 * Cosine-weighted fraction of the upper hemisphere the patch's own skyline
 * fills, from the same `HORIZON_AZIMUTHS` raw channels: `mean(max(sin h, 0)²)`
 * over the stored azimuths. Unclamped that would be `1 − mean(cos²h)`, but the
 * clamp is the point and the two differ wherever a skyline is negative.
 *
 * A skyline BELOW the local horizontal is sky, not terrain: a horizontal patch
 * receives nothing from under its own horizontal plane, so those azimuths
 * contribute zero rather than `sin²h`. Open ground reads the body's own limb
 * bound there — negative on every azimuth — and without the clamp every flat
 * plain would claim the fill light of a crater floor.
 *
 * At the shipped map's resolution this is far smaller than a crater's true sky
 * occlusion — README.md § What the fill term is actually worth.
 */
export function terrainViewFactor(enc: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < HORIZON_AZIMUTHS; i++) {
    const s = Math.max(decodeSin(enc[i]), 0);
    sum += s * s;
  }
  return sum / HORIZON_AZIMUTHS;
}
