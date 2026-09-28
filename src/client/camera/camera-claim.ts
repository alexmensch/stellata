// The claim-the-camera sequence. See README.md#the-claim-the-camera-sequence.

export interface CameraClaimGates {
  isWarpActive: () => boolean;
  isAimActive: () => boolean;
  isObserveTransitionActive: () => boolean;
  cancelUnfocusLerp: () => void;
  cancelFocusLerp: () => void;
}

/** A warp, an aim or an observe transition owns the camera. */
export function isCameraHeld(gates: CameraClaimGates): boolean {
  return gates.isWarpActive() || gates.isAimActive() || gates.isObserveTransitionActive();
}

/** Refuses while held, cancelling nothing; otherwise cancels both focus
 *  lerps and grants. */
export function claimCamera(gates: CameraClaimGates): boolean {
  if (isCameraHeld(gates)) return false;
  gates.cancelUnfocusLerp();
  gates.cancelFocusLerp();
  return true;
}
