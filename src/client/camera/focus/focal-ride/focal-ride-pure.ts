// Pure step function for the focal-frame ride — how far to translate the
// camera / orbit target / transition caches each frame so the focused star
// stays glued to NDC centre. See /src/client/binaries/README.md#focal-frame-ride-no-rebase.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// Once the camera has drifted this many × the eye distance from the focal
// object, the origin recentres onto it. The float32 modelview cancellation
// near the focal object projects ≈ (camFromOrigin / eye) · 2⁻²³ rad of
// jitter, so bounding the ratio bounds the jitter (16 · 2⁻²³ ≈ 2e-6 rad,
// sub-pixel at any framing). This is the ONE kind-agnostic precision lever:
// the per-object shader pin (uPinFocusToCenter) can only ever be per-shader,
// but recentring the shared origin fixes every layer near the focal object
// at once, for every hard focus kind — current or future.
export const FOCAL_ORIGIN_DRIFT_RATIO = 16;

/** True when the camera has drifted far enough from the focal object — its
 *  distance from the local origin exceeds FOCAL_ORIGIN_DRIFT_RATIO × the eye
 *  distance — that the floating origin should recentre onto it to restore
 *  float32 precision. Kind-agnostic: keyed on camera geometry alone. */
export function shouldRecenterFocalOrigin(camFromOriginPc: number, eyeDistPc: number): boolean {
  return eyeDistPc > 0 && camFromOriginPc > eyeDistPc * FOCAL_ORIGIN_DRIFT_RATIO;
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
   *  focus ring, disc pin, and picker all resolve to, and what the seed
   *  frame snaps onto. */
  liveLocal: Vec3;
  /** Current orbit target. */
  target: Vec3;
  /** Current camera position — what observe parks ON the star, and so the
   *  seed frame's reference point in that mode. */
  cameraPosition: Vec3;
  /** True while the camera mode is observe, which moves the seed-frame
   *  re-snap from `target` to `cameraPosition`. */
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
 * - **Seed frame** (focal just changed, no warp): snap the point parked on
 *   the star — `target` in navigate, `cameraPosition` in observe — onto its
 *   live buffer position.
 * - **Warp / unfocus**: no translate; just resync the baseline.
 */
export function focalRideStep(i: FocalRideInputs): FocalRideStep {
  const seed = i.focal !== i.rideFocalIdx;
  const px = i.focalPert.x;
  const py = i.focalPert.y;
  const pz = i.focalPert.z;
  if (i.warpActive || seed) {
    const reSnap = seed && !i.warpActive && i.focal !== null;
    const from = i.observeMode ? i.cameraPosition : i.target;
    return {
      dx: reSnap ? i.liveLocal.x - from.x : 0,
      dy: reSnap ? i.liveLocal.y - from.y : 0,
      dz: reSnap ? i.liveLocal.z - from.z : 0,
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
