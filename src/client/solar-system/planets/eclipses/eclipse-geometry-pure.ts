// Shadow-axis geometry: where a caster's shadow axis passes a target, and
// where it meets the target's surface. Frame-agnostic and unit-agnostic —
// every argument shares one frame and one length unit.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Unit vector along the shadow axis: source → caster, extended. */
export function shadowAxisDirection(source: Readonly<Vec3>, caster: Readonly<Vec3>, out: Vec3): void {
  const dx = caster.x - source.x;
  const dy = caster.y - source.y;
  const dz = caster.z - source.z;
  const n = Math.hypot(dx, dy, dz);
  out.x = dx / n;
  out.y = dy / n;
  out.z = dz / n;
}

/** Perpendicular distance from `target` to the shadow axis through
 *  `caster`. The canon's γ is this over the target's equatorial radius. */
export function shadowAxisMiss(
  source: Readonly<Vec3>,
  caster: Readonly<Vec3>,
  target: Readonly<Vec3>,
): number {
  const u = { x: 0, y: 0, z: 0 };
  shadowAxisDirection(source, caster, u);
  const dx = target.x - caster.x;
  const dy = target.y - caster.y;
  const dz = target.z - caster.z;
  const along = dx * u.x + dy * u.y + dz * u.z;
  return Math.hypot(dx - along * u.x, dy - along * u.y, dz - along * u.z);
}

/**
 * Offset from `target`'s centre to where the shadow axis first meets a
 * sphere of radius `radius` about it — the sunward intersection, which is
 * the one the shadow actually lands on. Returns false when the axis
 * misses the sphere entirely.
 */
export function shadowAxisSurfaceHit(
  source: Readonly<Vec3>,
  caster: Readonly<Vec3>,
  target: Readonly<Vec3>,
  radius: number,
  out: Vec3,
): boolean {
  const u = { x: 0, y: 0, z: 0 };
  shadowAxisDirection(source, caster, u);
  const ox = caster.x - target.x;
  const oy = caster.y - target.y;
  const oz = caster.z - target.z;
  const b = ox * u.x + oy * u.y + oz * u.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return false;
  const s = -b - Math.sqrt(disc);
  out.x = ox + s * u.x;
  out.y = oy + s * u.y;
  out.z = oz + s * u.z;
  return true;
}

/**
 * Fraction of a body's diameter inside a target's umbral cone —
 * the umbral magnitude of a lunar eclipse. ≥1 is total, ≤0 is outside.
 *
 * The umbra converges: at distance `axialDist` behind the occulter its
 * radius is `occulterRadius − axialDist·(sourceRadius − occulterRadius)/
 * sourceDist`. `shadowEnlargement` scales the occulter's radius for an
 * atmosphere — the canons enlarge Earth's by ~2%, and the geometric
 * cone alone reads about 0.03 magnitudes shallow against them.
 */
export function umbralMagnitude(
  axialDist: number,
  missDist: number,
  bodyRadius: number,
  occulterRadius: number,
  sourceRadius: number,
  sourceDist: number,
  shadowEnlargement = 1,
): number {
  const occulter = occulterRadius * shadowEnlargement;
  const umbraRadius = occulter - (axialDist * (sourceRadius - occulter)) / sourceDist;
  return (umbraRadius + bodyRadius - missDist) / (2 * bodyRadius);
}

/** Planetodetic latitude (rad) of a planetocentric direction, for a
 *  spheroid of flattening `f`. Up to 0.19° from the planetocentric value
 *  on Earth — the canons tabulate the planetodetic one. */
export function planetodeticLatRad(centricLatRad: number, flattening: number): number {
  const oneMinusF2 = (1 - flattening) * (1 - flattening);
  return Math.atan2(Math.tan(centricLatRad), oneMinusF2);
}

/**
 * Instant in `[lo, hi]` minimising `f`, by coarse scan then ternary
 * refinement. `f` must be unimodal across the bracket, which the
 * axis-miss distance is either side of an eclipse.
 */
export function argMin(
  f: (t: number) => number,
  lo: number,
  hi: number,
  coarseStep: number,
  tolerance: number,
): number {
  let bestT = lo;
  let bestV = Infinity;
  for (let t = lo; t <= hi; t += coarseStep) {
    const v = f(t);
    if (v < bestV) {
      bestV = v;
      bestT = t;
    }
  }
  let a = Math.max(lo, bestT - coarseStep);
  let b = Math.min(hi, bestT + coarseStep);
  while (b - a > tolerance) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (f(m1) < f(m2)) b = m2;
    else a = m1;
  }
  return (a + b) / 2;
}
