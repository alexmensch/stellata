// Soft-penumbra ray–sphere shadow math — CPU mirror of the caster loop
// in planet-mesh.frag.glsl. Shader is the render path; this mirror is
// test-pinned and feeds transit search tests.

/** Caster-array capacity — mirrors `MAX_CASTERS` in
 *  planet-mesh.frag.glsl. Saturn's seven in-scope moons are the largest
 *  family. */
export const MAX_SHADOW_CASTERS = 8;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Fraction of host light reaching a surface point `(px, py, pz)` whose
 * sun direction is the unit vector `(sx, sy, sz)`, past one spherical
 * caster at `(cx, cy, cz)` with radius `r` (all one consistent frame).
 * `sunAngRad` is the host's angular radius seen from the point — the
 * penumbra half-width grows by it per unit distance along the ray, so
 * the Sun's ~0.5° disc yields soft-edged shadows and the antumbral
 * (annular) case falls out when the caster's angular size drops below
 * the host's. 1 = unshadowed, 0 = full umbra.
 */
export function casterShadowFactor(
  px: number, py: number, pz: number,
  sx: number, sy: number, sz: number,
  cx: number, cy: number, cz: number,
  r: number,
  sunAngRad: number,
): number {
  const dx = cx - px;
  const dy = cy - py;
  const dz = cz - pz;
  const tAlong = dx * sx + dy * sy + dz * sz;
  if (tAlong <= 0) return 1;
  const mx = dx - tAlong * sx;
  const my = dy - tAlong * sy;
  const mz = dz - tAlong * sz;
  const miss = Math.sqrt(mx * mx + my * my + mz * mz);
  const pen = Math.max(tAlong * sunAngRad, 1e-30);
  return smoothstep(r - pen, r + pen, miss);
}
