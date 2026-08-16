// Surface relief in the mesh shader: the tangent-space normal perturbation
// (CPU mirror of stellataReliefNormal in ../planet-mesh.frag.glsl, the
// render path) and the limb bound on how far past the terminator it may light.

/** Below this the east direction is numerically undefined and the
 *  perturbation is dropped — mirrors the guard in the GLSL. */
export const RELIEF_POLE_EPS = 1e-6;

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
};

const horizonSin = (groundRadiusM: number, summitRadiusM: number): number =>
  Math.sqrt(Math.max(0, 1 - (groundRadiusM / summitRadiusM) ** 2));

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
    horizonSin(referenceM, summitM),
    horizonSin(referenceM + span[0], summitM),
  ];
}

/**
 * Geometric normal `n` perturbed by one texel of a `<body>-normal.webp`
 * map, all in one consistent frame (view space in the shader). `pole` is
 * the body's north pole; `enc` is the texel's raw R,G in [0, 1], carrying
 * the map's (+x east, +y north, +z out) frame —
 * `data/textures/README.md` § Surface relief.
 */
export function reliefNormal(
  n: readonly [number, number, number],
  pole: readonly [number, number, number],
  enc: readonly [number, number],
): [number, number, number] {
  const ex = pole[1] * n[2] - pole[2] * n[1];
  const ey = pole[2] * n[0] - pole[0] * n[2];
  const ez = pole[0] * n[1] - pole[1] * n[0];
  const eLen = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (eLen < RELIEF_POLE_EPS) return [n[0], n[1], n[2]];

  const eastX = ex / eLen;
  const eastY = ey / eLen;
  const eastZ = ez / eLen;
  const northX = n[1] * eastZ - n[2] * eastY;
  const northY = n[2] * eastX - n[0] * eastZ;
  const northZ = n[0] * eastY - n[1] * eastX;

  const tx = enc[0] * 2 - 1;
  const ty = enc[1] * 2 - 1;
  const tz = Math.sqrt(Math.max(1 - (tx * tx + ty * ty), 0));

  const rx = eastX * tx + northX * ty + n[0] * tz;
  const ry = eastY * tx + northY * ty + n[1] * tz;
  const rz = eastZ * tx + northZ * ty + n[2] * tz;
  const len = Math.sqrt(rx * rx + ry * ry + rz * rz);
  return [rx / len, ry / len, rz / len];
}
