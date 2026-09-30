// cam and tgt measured from the anchor the receiver rebuilds. See
// README.md#what-counts-as-a-camera-move.

import * as THREE from 'three';
import type { Stellata } from '../../stellata';
import { isHardTarget, type Target } from '../../camera/focus/focus-target';

const anchorScratch = new THREE.Vector3();

/**
 * cam and tgt as the wire means them: relative to the anchor the RECEIVER
 * re-establishes, which for a hard focus is the focal object itself
 * (`applyDecodedView` recentres onto it before either lands).
 *
 * The sender's own origin recentres only once the camera has drifted 16× the
 * eye distance (`../../camera/focus/focal-ride/focal-ride-pure.ts`), and between two of
 * those the moving-focal ride translates camera and target together every
 * frame. Raw local values therefore drift out of any frame the receiver
 * rebuilds — up to 16 eye distances of pose error — while carrying motion the
 * viewer cannot see, which on a scale-relative change detector is unbounded
 * URL churn. Subtracting the anchor removes both at once.
 *
 * Both writers read this, so the change detector and the encoder cannot
 * disagree about what has moved. A pose left un-anchored — no focus, a
 * soft-kind one, or a source that will not resolve — is one the receiver
 * rebuilds from `worldOffset` instead, which `currentStateOf` emits on
 * exactly the complement of this test.
 */
export function anchoredPose(
  stellata: Stellata,
  focused: Target | null,
  outCam: THREE.Vector3,
  outTgt: THREE.Vector3,
): void {
  outCam.copy(stellata.camera.position);
  outTgt.copy(stellata.controls.target);
  if (!isHardTarget(focused)) return;
  if (!stellata.focusables[focused.kind].localPositionInto(focused.idx, anchorScratch)) return;
  outCam.sub(anchorScratch);
  outTgt.sub(anchorScratch);
}
