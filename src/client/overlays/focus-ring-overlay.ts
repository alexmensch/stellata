import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { projectToScreenInto } from './overlay-project';
import { setNumAttr, setStyle } from './dirty-attr';

// Canonical screen-pixel radius for the dashed focus ring. Exported so the
// HUD ring (which morphs out of it during navigate↔observe transitions) and
// the POI ring (same visual indicator at a different anchor) can pin to the
// same value instead of carrying duplicate magic numbers.
export const FOCUS_RING_RADIUS_PX = 24;

export function createFocusRingOverlay(stellata: Stellata) {
  const ring = document.getElementById('focus-ring') as unknown as SVGCircleElement;
  const v = new THREE.Vector3();
  const outXY: [number, number] = [0, 0];

  // Sentinel-init: NaN for numeric attrs (any real write differs by > 0.05)
  // and a poison string for display (any 'none' / '' write differs from the
  // poison). Without poison, the first show() after init would skip the
  // write because the steady-state display is '' and the DOM default is '',
  // but a parent stylesheet could resolve `pointer-events` / `visibility`
  // differently — keep the first-frame write explicit.
  let lastCx = NaN;
  let lastCy = NaN;
  let lastR = NaN;
  let lastDisplay = '\0';

  const hide = () => { lastDisplay = setStyle(ring, 'display', 'none', lastDisplay); };
  const show = () => { lastDisplay = setStyle(ring, 'display', '', lastDisplay); };

  const syncVisibility = () => {
    if (stellata.getFocusedHardTarget() === null) hide();
    else show();
  };
  stellata.on('focus', syncVisibility);
  syncVisibility();

  stellata.on('frame', () => {
    const target = stellata.getFocusedHardTarget();
    if (target === null) return;

    // During the navigate↔observe transition the ring smoothly shrinks to
    // 0 (enter) or grows back to FOCUS_RING_RADIUS_PX (exit) so it visually morphs
    // into the HUD ring instead of popping out. In steady-state observe
    // the ring stays hidden — the HUD ring takes over the "you are here"
    // role.
    const transition = stellata.getObserveTransitionProgress();
    if (stellata.getCameraMode() === 'observe' && !transition) {
      hide();
      return;
    }

    const camera = stellata.camera;
    let r = FOCUS_RING_RADIUS_PX;
    if (transition) {
      r = transition.kind === 'enter'
        ? FOCUS_RING_RADIUS_PX * (1 - transition.f)
        : FOCUS_RING_RADIUS_PX * transition.f;
      if (r <= 0.5) {
        hide();
        return;
      }
    } else {
      // Steady-state navigate: skip the ring when the focal object's rendered
      // disc exceeds the ring diameter — the ring becomes redundant chrome
      // on top of the object. Skipped during transitions because the disc is
      // about to be hidden / has just appeared anyway.
      const sizePx = stellata.focusables[target.kind].renderedSizePx(target.idx);
      if (sizePx > FOCUS_RING_RADIUS_PX * 2) {
        hide();
        return;
      }
      // Visible orbit rings (planet or binary) already mark the object, so
      // the ring would just add noise readable as an inner orbital — see
      // overlays/README.md.
      if (stellata.anyOrbitRingVisible()) {
        hide();
        return;
      }
    }

    // Project the focal object to screen. During the enter transition the
    // projection naturally slides toward screen-centre as the camera
    // approaches; during the exit transition it starts degenerate (camera
    // sits at the object) and becomes well-defined as the camera pulls away.
    // Either way, fall back to screen-centre when the projection fails so
    // the shrinking/growing ring still has a sensible centre.
    if (!stellata.focalLocalPositionInto(v)) { hide(); return; }
    const projected = projectToScreenInto(v, camera, window.innerWidth, window.innerHeight, outXY);
    let sx: number, sy: number;
    if (!projected) {
      if (!transition) { hide(); return; }
      sx = window.innerWidth * 0.5;
      sy = window.innerHeight * 0.5;
    } else {
      sx = outXY[0];
      sy = outXY[1];
    }

    show();
    lastCx = setNumAttr(ring, 'cx', sx, lastCx);
    lastCy = setNumAttr(ring, 'cy', sy, lastCy);
    lastR = setNumAttr(ring, 'r', r, lastR);
  });
}
