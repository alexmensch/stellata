// The focal AnchorPolicy: keep the floating origin on the focal object as
// it moves under time advance. See ./README.md § Moving-focal ride.

import * as THREE from 'three';
import type { AnchorPolicy } from '../../frame/floating-origin';
import { shouldRecenterFocalOrigin } from './focal-ride-pure';

export interface FocalAnchorDeps {
  /** A hard kind is focused — soft kinds never recentre. */
  hasHardFocus(): boolean;
  /** A camera-owning animation is running (warp / aim / observe-aim /
   *  focus-park lerp / observe transition). Those reference the current
   *  frame and re-snap themselves, so a recentre under them fights the
   *  animation. */
  isCameraBusy(): boolean;
  /** Live references, all in the renderer's local frame. */
  cameraPosition: THREE.Vector3;
  orbitTarget: THREE.Vector3;
  worldOffset: Readonly<THREE.Vector3>;
}

/**
 * The focal-frame rides translate the camera to follow the object, so
 * under scrubber fast-forward the camera drifts far from the fixed
 * focus-time origin — reviving the float32 modelview cancellation the
 * floating origin exists to prevent. Recentring onto the look target
 * (glued to the object by the ride) restores camera-from-origin ≈ eye
 * distance. Kind-agnostic: keyed on camera geometry, not the focus kind.
 */
export function makeFocalAnchorPolicy(deps: FocalAnchorDeps): AnchorPolicy {
  return (out) => {
    if (!deps.hasHardFocus() || deps.isCameraBusy()) return null;
    const eye = deps.cameraPosition.distanceTo(deps.orbitTarget);
    if (!shouldRecenterFocalOrigin(deps.cameraPosition.length(), eye)) return null;
    return out.copy(deps.orbitTarget).add(deps.worldOffset);
  };
}
