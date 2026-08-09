import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { targetsEqual, type Target } from '../camera/focus/focus-target';
import { fmtDistAuto } from '../ui/distance-util';
import { targetDisplayName } from './target-name';
import { AIM_DEGENERATE_DIST_PC } from '../camera/controls/aim-controller';
import {
  buildArrowSvgPath,
  screenDirToTarget,
  ARROW_HEAD_DEPTH_PX,
  ARROW_LABEL_OFFSET_PX,
  ARROW_LABEL_PADDING_PX,
  ARROW_PIXEL_LENGTH,
} from './arrow-path';
import { projectToScreen } from './overlay-project';
import { ringRadiusPx, computeShaftStartRadius, hudAnchorInto } from './hud-overlay';
import {
  applyFade,
  emptyFadeState,
  setNumAttr,
  setStrAttr,
  setStyle,
  setText,
  type FadeState,
} from './dirty-attr';
import { focusedArrowFadeAlpha } from './arrow-fade';
import { FOCUS_RING_RADIUS_PX } from './focus-ring-overlay';

// Point-of-interest overlay — renders the pinned-object list
// (src/client/poi/README.md) in BOTH camera modes. Each pin renders two
// ways:
//   - **On screen** (POI projects inside the viewport, with a small
//     pull-in margin so labels don't clip at the edge): a thin ring
//     around the object + a text label `name · ConCode · distance`
//     anchored at a fixed pixel offset from the ring rim. The fixed-px
//     anchor keeps the label-to-object distance constant as FOV changes.
//     Clicking either the ring's label or the object itself applies the
//     mode's click semantics (unpin toggle in observe, the click ladder
//     in navigate — InputController.applyObjectClick).
//   - **Off screen**: a chevron arrow on the active ring rim (focus
//     ring in navigate, HUD ring in observe) points toward the POI
//     direction, with a name-only label by the chevron tip. Clicking
//     that label slerps the camera so the POI lands at view centre
//     (Stellata.aimAt) — same affordance the Sol/GC labels give in
//     the HUD.
// Distances are measured from the LIVE camera (in observe the camera is
// parked at the focal object, so this equals the old from-the-focal
// reading). Visibility is gated as a HUD widget — hidden when the HUD
// checkbox is off, during warp (CSS rule), and during the
// navigate↔observe transition.

// Detection margin: a POI within ~40 px of the viewport edge still counts
// as on-screen so its label survives small look-around drifts without
// flipping to arrow mode every couple of frames.
export const ON_SCREEN_PULL_IN_PX = 40;

/**
 * Decide whether a projected POI should render as an on-screen label /
 * ring or as an off-screen arrow chevron on the HUD ring rim. True only
 * when the projection succeeded AND the point sits inside the viewport
 * with at least `ON_SCREEN_PULL_IN_PX` margin on every edge — the margin
 * suppresses the rapid flip between on-screen-label and off-screen-arrow
 * presentations during small look-around drifts at the viewport edges.
 */
export function isPoiOnScreen(
  projected: [number, number] | null,
  w: number,
  h: number,
): boolean {
  return (
    projected !== null &&
    projected[0] >= ON_SCREEN_PULL_IN_PX &&
    projected[0] <= w - ON_SCREEN_PULL_IN_PX &&
    projected[1] >= ON_SCREEN_PULL_IN_PX &&
    projected[1] <= h - ON_SCREEN_PULL_IN_PX
  );
}
// Per-POI ring around the pinned object — same screen radius as the
// focus ring so the two read as the same kind of indicator (shared
// FOCUS_RING_RADIUS_PX). The on-screen label rides just outside this rim
// along a 45° diagonal, which is what makes the label-to-object distance
// FOV-invariant: ring radius is fixed in screen pixels regardless of how
// FOV scales the rendered disc.
const LABEL_RIM_GAP_PX = 6;
const LABEL_DIAG = (FOCUS_RING_RADIUS_PX + LABEL_RIM_GAP_PX) / Math.SQRT2;

export interface EntryDirtyState {
  // Dirty-tracked attribute / style state — POI entries persist for the
  // lifetime of the pin, so storing the last-written value lets the per-
  // frame handler skip identical writes during stationary observe
  // sessions. Sentinels guarantee the first write always happens.
  lastArrowD: string;
  lastArrowLabelDisplay: string;
  lastArrowLabelText: string;
  lastArrowLabelX: number;
  lastArrowLabelY: number;
  lastRingDisplay: string;
  lastRingCx: number;
  lastRingCy: number;
  lastOnScreenLabelDisplay: string;
  lastOnScreenLabelText: string;
  lastOnScreenLabelX: number;
  lastOnScreenLabelY: number;
}

interface Entry extends EntryDirtyState {
  target: Target;
  arrowPath: SVGPathElement;
  arrowLabel: SVGTextElement;
  ring: SVGCircleElement;
  onScreenLabel: SVGTextElement;
  // Arrow shaft length drawn this frame (0 when the arrow is hidden or
  // the POI renders on-screen). Feeds the shared disc-coverage fade.
  drawnArrowLen: number;
  fade: FadeState;
}

function poiPoolKey(t: Target): string {
  return `${t.kind}:${t.idx}`;
}

/**
 * Poison-init values for every per-attribute sentinel on a POI Entry. Used
 * by createEntry — first-time init wipes every sentinel so the very first
 * visible frame's writes through the dirty-attr gate all land.
 */
export function emptyEntryDirtyState(): EntryDirtyState {
  return {
    lastArrowD: '\0',
    lastArrowLabelDisplay: '\0',
    lastArrowLabelText: '\0',
    lastArrowLabelX: NaN,
    lastArrowLabelY: NaN,
    lastRingDisplay: '\0',
    lastRingCx: NaN,
    lastRingCy: NaN,
    lastOnScreenLabelDisplay: '\0',
    lastOnScreenLabelText: '\0',
    lastOnScreenLabelX: NaN,
    lastOnScreenLabelY: NaN,
  };
}

/**
 * Wipe the post-hide subset of an Entry's per-attribute sentinels back to
 * poison. The visible `d` + `display` sentinels are NOT wiped — they pass
 * through the dirty-attr gate in hideEntry, so the cached value already
 * reflects the hidden state (`''` for d, `'none'` for display). Used by
 * hideEntry so the next show-from-hide cycle's first text/x/y/cx/cy write
 * lands — same shape as hud-overlay's resetArrowSentinels.
 */
export function resetEntrySentinels(state: EntryDirtyState): void {
  state.lastArrowLabelText = '\0';
  state.lastArrowLabelX = NaN;
  state.lastArrowLabelY = NaN;
  state.lastRingCx = NaN;
  state.lastRingCy = NaN;
  state.lastOnScreenLabelText = '\0';
  state.lastOnScreenLabelX = NaN;
  state.lastOnScreenLabelY = NaN;
}

export function createPoiOverlay(stellata: Stellata): void {
  const arrowsGroup = document.getElementById('poi-arrows') as unknown as SVGGElement | null;
  const ringsGroup = document.getElementById('poi-rings') as unknown as SVGGElement | null;
  const labelsGroup = document.getElementById('poi-labels') as unknown as SVGGElement | null;
  if (!arrowsGroup || !ringsGroup || !labelsGroup) return;

  const catalog = stellata.catalog;
  const pool = new Map<string, Entry>();

  const tmpPoiLocal = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpAim = new THREE.Vector3();
  const tmpOrigin = new THREE.Vector3();
  const tmpAnchor: [number, number] = [0, 0];

  // Position + name dispatch through the kind-generic registries so a
  // new pinnable kind needs no overlay edit (camera/focus/README.md
  // § FocusableProviders).
  function poiLocalPositionInto(t: Target, out: THREE.Vector3): boolean {
    return stellata.focusables[t.kind].localPositionInto(t.idx, out);
  }

  function poiName(t: Target): string {
    return targetDisplayName(stellata, t);
  }

  function createEntry(target: Target): Entry {
    const NS = 'http://www.w3.org/2000/svg';
    const arrowPath = document.createElementNS(NS, 'path') as SVGPathElement;
    arrowPath.setAttribute('class', 'poi-arrow');
    arrowsGroup!.appendChild(arrowPath);

    const arrowLabel = document.createElementNS(NS, 'text') as SVGTextElement;
    arrowLabel.setAttribute('class', 'poi-arrow-label');
    arrowLabel.setAttribute('text-anchor', 'start');
    arrowLabel.setAttribute('dominant-baseline', 'central');
    arrowsGroup!.appendChild(arrowLabel);

    const ring = document.createElementNS(NS, 'circle') as SVGCircleElement;
    ring.setAttribute('class', 'poi-ring');
    ring.setAttribute('r', FOCUS_RING_RADIUS_PX.toFixed(1));
    ringsGroup!.appendChild(ring);

    const onScreenLabel = document.createElementNS(NS, 'text') as SVGTextElement;
    onScreenLabel.setAttribute('class', 'poi-label');
    onScreenLabel.setAttribute('text-anchor', 'start');
    onScreenLabel.setAttribute('dominant-baseline', 'central');
    labelsGroup!.appendChild(onScreenLabel);

    // Click affordances. On-screen label applies the mode's click
    // semantics — one behaviour whether the user hits the object or its
    // label. Off-screen arrow label slerps the camera toward the POI (it
    // isn't visible so "show me where it is" is the natural action). The
    // ring itself stays click-through — the object underneath is already
    // a canvas click target, and putting pointer-events on the ring would
    // shadow that.
    onScreenLabel.addEventListener('click', () => {
      stellata.input.applyObjectClick(target);
    });
    arrowLabel.addEventListener('click', () => {
      if (!poiLocalPositionInto(target, tmpAim)) return;
      stellata.aimAt(tmpAim);
    });

    return {
      target, arrowPath, arrowLabel, ring, onScreenLabel,
      drawnArrowLen: 0,
      fade: emptyFadeState(),
      ...emptyEntryDirtyState(),
    };
  }

  function destroyEntry(e: Entry) {
    e.arrowPath.remove();
    e.arrowLabel.remove();
    e.ring.remove();
    e.onScreenLabel.remove();
  }

  function syncPool() {
    const pois = stellata.pois.get();
    const seen = new Set<string>(pois.map(poiPoolKey));
    for (const [key, e] of pool) {
      if (!seen.has(key)) {
        destroyEntry(e);
        pool.delete(key);
      }
    }
    for (const t of pois) {
      const key = poiPoolKey(t);
      if (!pool.has(key)) pool.set(key, createEntry(t));
    }
  }

  // Hide an entry. The visible d / display writes go through the dirty-
  // track gate; the remaining numeric + text sentinels are wiped via
  // resetEntrySentinels so the next show-from-hide cycle's first write
  // always lands — without this reset, re-pinning at slightly different
  // geometry could skip the setAttribute and inherit stale cx/cy/lx/ly
  // from the prior session.
  function hideEntry(e: Entry) {
    e.lastArrowD = setStrAttr(e.arrowPath, 'd', '', e.lastArrowD);
    e.lastArrowLabelDisplay = setStyle(e.arrowLabel, 'display', 'none', e.lastArrowLabelDisplay);
    e.lastRingDisplay = setStyle(e.ring, 'display', 'none', e.lastRingDisplay);
    e.lastOnScreenLabelDisplay = setStyle(e.onScreenLabel, 'display', 'none', e.lastOnScreenLabelDisplay);
    e.drawnArrowLen = 0;
    e.fade.lastOpacity = -Infinity;
    e.fade.lastPointerEvents = '\0';
    resetEntrySentinels(e);
  }

  // Idempotent show/hide: track visibility so the per-frame handler's
  // bail paths (no pins, HUD off, transition) don't re-set the same
  // display values 60×/sec.
  let groupsVisible = false;
  function hideAll() {
    if (!groupsVisible) return;
    arrowsGroup!.style.display = 'none';
    ringsGroup!.style.display = 'none';
    labelsGroup!.style.display = 'none';
    groupsVisible = false;
  }

  function showAll() {
    if (groupsVisible) return;
    arrowsGroup!.style.display = '';
    ringsGroup!.style.display = '';
    labelsGroup!.style.display = '';
    groupsVisible = true;
  }

  stellata.on('pois', syncPool);
  syncPool();

  stellata.on('frame', () => {
    const pois = stellata.pois.get();
    if (pois.length === 0) {
      hideAll();
      return;
    }

    const filter = stellata.filters.getFilter();
    if (!filter.showHud || stellata.observe.isActive()) {
      hideAll();
      return;
    }

    showAll();

    const camera = stellata.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cameraMode = stellata.focus.getCameraMode();
    const camPos = camera.position;
    const focusedTarget = stellata.focus.getFocusedTarget();

    // Off-screen arrows mirror the HUD's Sol/GC arrows: shafts attach to
    // whichever ring is active (focus ring in navigate, HUD ring in
    // observe) around the shared HUD anchor.
    if (!stellata.focus.focalLocalPositionInto(tmpOrigin)) {
      tmpOrigin.copy(stellata.controls.target);
    }
    hudAnchorInto(tmpOrigin, camera, w, h, tmpAnchor, cameraMode === 'observe');
    const cx = tmpAnchor[0];
    const cy = tmpAnchor[1];

    const R = ringRadiusPx(camera.fov, filter.sizeMax);
    const shaftStartPx = computeShaftStartRadius(cameraMode, null, R);
    const targetMarginPx = Math.max(filter.sizeMax, 0);

    let maxArrowLenPx = 0;

    for (const t of pois) {
      const e = pool.get(poiPoolKey(t));
      if (!e) continue;
      e.drawnArrowLen = 0;

      // The focused object's own pin is suppressed — a POI ring/label on
      // the object the camera is parked at (or orbiting) is noise. The
      // pin itself survives; the chrome returns on unfocus/refocus.
      if (targetsEqual(t, focusedTarget)) {
        hideEntry(e);
        continue;
      }

      if (!poiLocalPositionInto(t, tmpPoiLocal)) {
        hideEntry(e);
        continue;
      }
      const projected = projectToScreen(tmpPoiLocal, camera, w, h);
      const onScreen = isPoiOnScreen(projected, w, h);

      const distPc = tmpPoiLocal.distanceTo(camPos);

      const name = poiName(t);
      const conIdx = t.kind === 'star' ? catalog.constellation[t.idx] : 255;
      const conCode = conIdx !== 255 ? catalog.constellations[conIdx].code : '';

      if (onScreen && projected) {
        // Hide arrow chrome.
        e.lastArrowD = setStrAttr(e.arrowPath, 'd', '', e.lastArrowD);
        e.lastArrowLabelDisplay = setStyle(e.arrowLabel, 'display', 'none', e.lastArrowLabelDisplay);

        // Ring at the projected POI.
        e.lastRingDisplay = setStyle(e.ring, 'display', '', e.lastRingDisplay);
        e.lastRingCx = setNumAttr(e.ring, 'cx', projected[0], e.lastRingCx);
        e.lastRingCy = setNumAttr(e.ring, 'cy', projected[1], e.lastRingCy);

        // On-screen label anchored just outside the ring rim along a 45°
        // diagonal. Fixed-pixel offset → label-to-object distance is
        // FOV-invariant; the rendered disc may grow or shrink with FOV
        // but the label stays clear of the ring at all zoom levels.
        const fullText = conCode
          ? `${name} · ${conCode} · ${fmtDistAuto(distPc)}`
          : `${name} · ${fmtDistAuto(distPc)}`;
        e.lastOnScreenLabelDisplay = setStyle(e.onScreenLabel, 'display', '', e.lastOnScreenLabelDisplay);
        e.lastOnScreenLabelText = setText(e.onScreenLabel, fullText, e.lastOnScreenLabelText);
        const lx = projected[0] + LABEL_DIAG;
        const ly = projected[1] + LABEL_DIAG;
        e.lastOnScreenLabelX = setNumAttr(e.onScreenLabel, 'x', lx, e.lastOnScreenLabelX);
        e.lastOnScreenLabelY = setNumAttr(e.onScreenLabel, 'y', ly, e.lastOnScreenLabelY);
        continue;
      }

      // Off screen — draw arrow on the HUD ring rim. Screen-direction
      // derivation via the shared cascade (target's projection if
      // available, view-space xy fallback otherwise).
      e.lastRingDisplay = setStyle(e.ring, 'display', 'none', e.lastRingDisplay);
      e.lastOnScreenLabelDisplay = setStyle(e.onScreenLabel, 'display', 'none', e.lastOnScreenLabelDisplay);

      tmpDir.set(
        tmpPoiLocal.x - camPos.x,
        tmpPoiLocal.y - camPos.y,
        tmpPoiLocal.z - camPos.z,
      );
      const dirLenSq = tmpDir.lengthSq();
      if (dirLenSq < AIM_DEGENERATE_DIST_PC * AIM_DEGENERATE_DIST_PC) {
        hideEntry(e);
        continue;
      }
      tmpDir.multiplyScalar(1 / Math.sqrt(dirLenSq));

      const sdir = screenDirToTarget(cx, cy, projected, tmpDir, camera);
      if (!sdir) {
        hideEntry(e);
        continue;
      }
      const sux = sdir[0];
      const suy = sdir[1];

      // Shaft length defaults to ARROW_PIXEL_LENGTH; shrunk so the tip
      // stops `targetMarginPx` short of the projected target when the
      // POI projects inside the nominal shaft length (close to the
      // viewport edge but still slightly inside the pull-in margin).
      let shaftLengthPx = ARROW_PIXEL_LENGTH;
      if (projected) {
        const tdx = projected[0] - cx;
        const tdy = projected[1] - cy;
        const projAlong = tdx * sux + tdy * suy;
        if (projAlong > 0) {
          const allowed = projAlong - shaftStartPx - targetMarginPx;
          if (allowed < shaftLengthPx) shaftLengthPx = allowed;
        }
      }
      if (shaftLengthPx <= 0) {
        hideEntry(e);
        continue;
      }

      const shaftStartX = cx + sux * shaftStartPx;
      const shaftStartY = cy + suy * shaftStartPx;
      const tipX = shaftStartX + sux * shaftLengthPx;
      const tipY = shaftStartY + suy * shaftLengthPx;

      const d = buildArrowSvgPath(shaftStartX, shaftStartY, tipX, tipY);
      if (!d) {
        hideEntry(e);
        continue;
      }
      e.lastArrowD = setStrAttr(e.arrowPath, 'd', d, e.lastArrowD);
      e.drawnArrowLen = shaftLengthPx;
      if (shaftLengthPx > maxArrowLenPx) maxArrowLenPx = shaftLengthPx;

      // Name-only label clamped to viewport with the same padding the
      // Sol/GC arrows use.
      const labelAnchorX = tipX + ARROW_LABEL_OFFSET_PX + ARROW_HEAD_DEPTH_PX;
      const labelAnchorY = tipY - ARROW_LABEL_OFFSET_PX;
      const sx = clamp(labelAnchorX, ARROW_LABEL_PADDING_PX, w - ARROW_LABEL_PADDING_PX);
      const sy = clamp(labelAnchorY, ARROW_LABEL_PADDING_PX, h - ARROW_LABEL_PADDING_PX);
      e.lastArrowLabelDisplay = setStyle(e.arrowLabel, 'display', '', e.lastArrowLabelDisplay);
      e.lastArrowLabelText = setText(e.arrowLabel, name, e.lastArrowLabelText);
      e.lastArrowLabelX = setNumAttr(e.arrowLabel, 'x', sx, e.lastArrowLabelX);
      e.lastArrowLabelY = setNumAttr(e.arrowLabel, 'y', sy, e.lastArrowLabelY);
    }

    // Shared disc-coverage fade across the whole arrow set, mirroring the
    // Sol/GC pair: the longest drawn shaft drives the threshold so one
    // shrunk-to-target arrow doesn't drag its still-visible siblings to
    // alpha 0. On-screen rings/labels don't fade — they anchor at the
    // POI's own projection, not the focus origin.
    if (maxArrowLenPx > 0) {
      const discRadiusPx = stellata.getFocusedDiscRadiusPx();
      const alpha = focusedArrowFadeAlpha(
        cameraMode, null, discRadiusPx, maxArrowLenPx, shaftStartPx,
      );
      for (const t of pois) {
        const e = pool.get(poiPoolKey(t));
        if (!e || e.drawnArrowLen <= 0) continue;
        applyFade([e.arrowPath, e.arrowLabel], e.arrowLabel, alpha, e.fade);
      }
    }
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
