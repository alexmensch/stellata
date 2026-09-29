// The one claim-the-camera sequence clicks, aims and warps take. See README.md#the-claim-the-camera-sequence.

export interface CameraClaimGates {
  isWarpActive: () => boolean;
  isAimActive: () => boolean;
  isObserveTransitionActive: () => boolean;
  cancelUnfocusLerp: () => void;
  cancelFocusLerp: () => void;
}

/** The only handle a camera-claiming site holds, so none can cancel the
 *  focus lerps outside `claim`. */
export interface CameraClaim {
  /** A warp, an aim or an observe transition owns the camera. */
  isHeld(): boolean;
  /** Refuses while held, cancelling nothing; otherwise cancels both focus
   *  lerps and grants. */
  claim(): boolean;
}

export function createCameraClaim(gates: CameraClaimGates): CameraClaim {
  const isHeld = () =>
    gates.isWarpActive() || gates.isAimActive() || gates.isObserveTransitionActive();
  return {
    isHeld,
    claim: () => {
      if (isHeld()) return false;
      gates.cancelUnfocusLerp();
      gates.cancelFocusLerp();
      return true;
    },
  };
}
