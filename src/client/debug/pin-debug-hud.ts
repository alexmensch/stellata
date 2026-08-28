import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { type DebugSection, buildDiagnosticReadout, setReadoutText } from './debug-panel';

// Focused-star-pin diagnostics. Latched signed min/max per axis
// capture transient excursions (trackpad pans can swing target by
// orders of magnitude past the 1e-6 pc engagement threshold and
// self-dampen back toward zero before the next "now" sample).

interface Latch {
  tgtMaxX: number; tgtMinX: number;
  tgtMaxY: number; tgtMinY: number;
  tgtMaxZ: number; tgtMinZ: number;
  tgtLenMax: number;
  camMaxX: number; camMinX: number;
  camMaxY: number; camMinY: number;
  camMaxZ: number; camMinZ: number;
  distCamMin: number; distCamMax: number;
  pinFlips: number;
  lastPinState: boolean;
  pinOffFrames: number;
}

function emptyLatch(): Latch {
  return {
    tgtMaxX: 0, tgtMinX: 0, tgtMaxY: 0, tgtMinY: 0, tgtMaxZ: 0, tgtMinZ: 0,
    tgtLenMax: 0,
    camMaxX: 0, camMinX: 0, camMaxY: 0, camMinY: 0, camMaxZ: 0, camMinZ: 0,
    distCamMin: Infinity, distCamMax: 0,
    pinFlips: 0, lastPinState: false, pinOffFrames: 0,
  };
}

export function buildPinSection(stellata: Stellata): DebugSection {
  const latch = emptyLatch();
  let visible = true;
  const engageScratch = new THREE.Vector3();

  const { root, body } = buildDiagnosticReadout({
    onResetLatches: () => { Object.assign(latch, emptyLatch()); },
  });

  const fmt = (n: number) => {
    if (n === 0) return '0';
    if (!Number.isFinite(n)) return String(n);
    return n.toExponential(2);
  };

  const onFrame = () => {
    const t = stellata.controls.target;
    const c = stellata.camera.position;
    const distCam = Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z);
    const tLen = Math.hypot(t.x, t.y, t.z);
    const pinNow = stellata.focus.isPinEngaged();
    // isPinEngaged() gates on navigate, so OBSERVE can only ever read NO —
    // labelled, or the readout looks like a fault and off-frames like a leak.
    const observing = stellata.focus.getCameraMode() === 'observe';
    // Pin engages on target ≈ focal's LIVE local position (baseline +
    // orbital perturbation), not target ≈ origin — a binary focal drifts.
    const focal = stellata.focus.getFocusedStar();
    const engageDistSq = focal !== null
      ? t.distanceToSquared(stellata.starLocalPositionInto(focal, engageScratch))
      : t.lengthSq();

    // Latches keep updating regardless of visibility — the user's
    // interaction may have spanned a collapse and we still want the
    // latched extremes to reflect the whole observation window.
    if (t.x > latch.tgtMaxX) latch.tgtMaxX = t.x;
    if (t.x < latch.tgtMinX) latch.tgtMinX = t.x;
    if (t.y > latch.tgtMaxY) latch.tgtMaxY = t.y;
    if (t.y < latch.tgtMinY) latch.tgtMinY = t.y;
    if (t.z > latch.tgtMaxZ) latch.tgtMaxZ = t.z;
    if (t.z < latch.tgtMinZ) latch.tgtMinZ = t.z;
    if (tLen > latch.tgtLenMax) latch.tgtLenMax = tLen;

    if (c.x > latch.camMaxX) latch.camMaxX = c.x;
    if (c.x < latch.camMinX) latch.camMinX = c.x;
    if (c.y > latch.camMaxY) latch.camMaxY = c.y;
    if (c.y < latch.camMinY) latch.camMinY = c.y;
    if (c.z > latch.camMaxZ) latch.camMaxZ = c.z;
    if (c.z < latch.camMinZ) latch.camMinZ = c.z;

    if (distCam < latch.distCamMin) latch.distCamMin = distCam;
    if (distCam > latch.distCamMax) latch.distCamMax = distCam;

    if (pinNow !== latch.lastPinState) { latch.pinFlips++; latch.lastPinState = pinNow; }
    if (!pinNow) latch.pinOffFrames++;

    if (!visible) return;

    setReadoutText(body,
      `focus: ${stellata.focus.getFocusedStar()}  mode: ${stellata.focus.getCameraMode()}\n` +
      `warp:${stellata.warp.isActive()}  aim:${stellata.aim.isActive()}\n` +
      `pin: ${observing ? 'n/a (navigate only)' : pinNow ? 'YES' : 'NO'}`
        + `  flips:${latch.pinFlips}  off-frames:${latch.pinOffFrames}\n` +
      `\n` +
      `target↔focal²: ${fmt(engageDistSq)} (engage <${stellata.focus.getPinEngageThresholdSq()})\n` +
      `target.len now: ${fmt(tLen)}  max: ${fmt(latch.tgtLenMax)}\n` +
      `target.x now: ${fmt(t.x)}  range: [${fmt(latch.tgtMinX)}, ${fmt(latch.tgtMaxX)}]\n` +
      `target.y now: ${fmt(t.y)}  range: [${fmt(latch.tgtMinY)}, ${fmt(latch.tgtMaxY)}]\n` +
      `target.z now: ${fmt(t.z)}  range: [${fmt(latch.tgtMinZ)}, ${fmt(latch.tgtMaxZ)}]\n` +
      `\n` +
      `camera.x now: ${fmt(c.x)}  range: [${fmt(latch.camMinX)}, ${fmt(latch.camMaxX)}]\n` +
      `camera.y now: ${fmt(c.y)}  range: [${fmt(latch.camMinY)}, ${fmt(latch.camMaxY)}]\n` +
      `camera.z now: ${fmt(c.z)}  range: [${fmt(latch.camMinZ)}, ${fmt(latch.camMaxZ)}]\n` +
      `\n` +
      `distCam now: ${fmt(distCam)} pc\n` +
      `distCam range: [${fmt(latch.distCamMin)}, ${fmt(latch.distCamMax)}] pc\n` +
      `controls.minDistance: ${fmt(stellata.controls.minDistance)} pc`);

    root.style.color = observing ? '#888' : pinNow ? '#0f0' : '#f33';
  };

  const unsubscribe = stellata.on('frame', onFrame);

  return {
    element: root,
    dispose: () => { unsubscribe(); },
    setVisible: (v: boolean) => { visible = v; },
  };
}
