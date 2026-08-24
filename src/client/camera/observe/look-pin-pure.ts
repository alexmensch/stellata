// The serialised look pin OBSERVE keeps in `controls.target`, and the one
// condition that invalidates it. See README.md § The serialised look pin.

interface Vec3Like { x: number; y: number; z: number }
interface QuatLike {
  readonly x: number; readonly y: number; readonly z: number; readonly w: number;
}

/** Distance along the view axis the pin is placed at, in parsecs.
 *
 *  Arbitrary by design — the pin carries a *direction* for URL round-trip
 *  and is never an orbit pivot while OBSERVE is active, so any non-zero
 *  distance encodes the same view. Not free of consequence, though:
 *  `position + forward * PIN` differences two near-equal magnitudes when the
 *  camera sits about this far from the local origin looking back toward it,
 *  which is the geometry a per-frame re-derivation loses the most digits in. */
export const LOOK_PIN_DIST_PC = 1;

/** Does the pin need re-deriving this frame?
 *
 *  **Only a rotation invalidates it.** A focal ride translates camera and
 *  target together through one delta (`Stellata.applyRideDelta`), which is
 *  exact and keeps a translated pin correct for free. Re-deriving from a
 *  translated camera instead lands `position + forward` a few ULP off the
 *  value the ride wrote — every frame, never converging — and the render
 *  gate reads that as a camera move (`../../render-gate/README.md`
 *  § Pose change). A NaN-seeded `pinnedAt` never compares equal, so the
 *  first call after a seed or a mode change always re-derives. */
export function lookPinStale(pinnedAt: QuatLike, cameraQuat: QuatLike): boolean {
  return pinnedAt.x !== cameraQuat.x
    || pinnedAt.y !== cameraQuat.y
    || pinnedAt.z !== cameraQuat.z
    || pinnedAt.w !== cameraQuat.w;
}

/** Write the pin `LOOK_PIN_DIST_PC` along the camera's forward axis.
 *  `forward` is the camera-local −Z already rotated into the local frame. */
export function writeLookPin(
  cameraPos: Vec3Like, forward: Vec3Like, out: Vec3Like,
): void {
  out.x = cameraPos.x + forward.x * LOOK_PIN_DIST_PC;
  out.y = cameraPos.y + forward.y * LOOK_PIN_DIST_PC;
  out.z = cameraPos.z + forward.z * LOOK_PIN_DIST_PC;
}
