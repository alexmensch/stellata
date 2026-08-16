// Tangent-space relief perturbation of a body's surface normal — CPU
// mirror of stellataReliefNormal in planet-mesh.frag.glsl. Shader is the
// render path; this mirror is test-pinned.

/** Below this the east direction is numerically undefined and the
 *  perturbation is dropped — mirrors the guard in the GLSL. */
export const RELIEF_POLE_EPS = 1e-6;

/**
 * Geometric normal `n` perturbed by one texel of a `<body>-normal.webp`
 * map, all in one consistent frame (view space in the shader). `pole` is
 * the body's north pole; `enc` is the texel's raw R,G in [0, 1].
 *
 * The map's frame is (+x east, +y north, +z out of the surface)
 * — `data/textures/README.md` § Surface relief. East is the direction of
 * increasing longitude, `cross(pole, n)`, and north the meridian tangent
 * that completes the frame; on the drawn spheroid both are exact, since a
 * surface of revolution puts its normal in the meridian plane. Blue is
 * dropped: z is positive by construction on a heightfield, so it
 * reconstructs, and the encoded channel is a constant.
 *
 * Both tangents degenerate at the poles. The map's own longitude
 * derivative is already zeroed past ±85°, so only the arbitrary meridian
 * is lost there, and the geometric normal stands in.
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
