// Pure step function for the focal-frame ride — how far to translate the
// camera / orbit target / transition caches each frame so the focused star
// stays glued to NDC centre. See src/client/binaries/README.md § Focal-frame ride.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FocalRideInputs {
  /** Currently focused star index, or null. */
  focal: number | null;
  /** Focal index the ride last serviced (its pose baseline). */
  rideFocalIdx: number | null;
  /** True while a warp owns the camera — the ride never translates then. */
  warpActive: boolean;
  /** This frame's focal perturbation from catalog baseline (float64). */
  focalPert: Vec3;
  /** Perturbation already baked into camera / target / pose caches. */
  lastAppliedPert: Vec3;
  /** Focal star's live local position from the star buffer — the point the
   *  focus ring, disc pin, and picker all resolve to. The seed frame snaps
   *  `target` onto this. */
  liveLocal: Vec3;
  /** Current orbit target. */
  target: Vec3;
  /** True while the camera mode is observe. The seed-frame re-snap is
   *  keyed on the navigate pin invariant (target sits ON the star); in
   *  observe the target is deliberately parked one parsec ahead of the
   *  camera as a look-direction pin, so re-snapping against it would
   *  translate the parked camera a full parsec off the focal star (the
   *  cold-load observe URL-restore bug). */
  observeMode: boolean;
}

export interface FocalRideStep {
  /** Translate camera / target / pose caches by this (zero ⇒ no move). */
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  /** New `lastAppliedPert` to store. */
  readonly px: number;
  readonly py: number;
  readonly pz: number;
  /** New `rideFocalIdx` to store. */
  readonly rideFocalIdx: number | null;
}

/**
 * One frame of the focal-frame ride.
 *
 * - **Steady focal** (same star, no warp): translate by the perturbation
 *   change since last frame, so orbital drift accumulates onto the pose
 *   while any user pan offset is preserved.
 * - **Seed frame** (focal just changed, no warp): snap `target` onto the
 *   star's live buffer position. `setFocus` sampled the perturbation at
 *   focus-event time, but sim-time may have advanced before this frame
 *   (fast scrub), so trusting that snap leaves a fixed residual offset —
 *   the star lands off-centre. Re-snapping here corrects it against the
 *   same buffer position every consumer projects. Suppressed in observe
 *   mode, where `target` is the look-direction pin (not on the star) and
 *   the camera itself is already parked at the live position.
 * - **Warp / unfocus**: no translate; just resync the baseline.
 */
export function focalRideStep(i: FocalRideInputs): FocalRideStep {
  const seed = i.focal !== i.rideFocalIdx;
  const px = i.focalPert.x;
  const py = i.focalPert.y;
  const pz = i.focalPert.z;
  if (i.warpActive || seed) {
    const reSnap = seed && !i.warpActive && i.focal !== null && !i.observeMode;
    return {
      dx: reSnap ? i.liveLocal.x - i.target.x : 0,
      dy: reSnap ? i.liveLocal.y - i.target.y : 0,
      dz: reSnap ? i.liveLocal.z - i.target.z : 0,
      px, py, pz,
      rideFocalIdx: i.focal,
    };
  }
  return {
    dx: px - i.lastAppliedPert.x,
    dy: py - i.lastAppliedPert.y,
    dz: pz - i.lastAppliedPert.z,
    px, py, pz,
    rideFocalIdx: i.focal,
  };
}
