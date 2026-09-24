import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { FocusController } from '../camera/focus/focus-controller';
import { DEFAULT_FILTER, type FilterState } from '../filters/filter-state';
import { makeFrameCtx } from '../scene/frame-ctx-mock';
import type { HudOverlay, HudUpdateOpts } from './hud-overlay';
import { hudSceneLayer } from './hud-scene-layer';

const SOL = 3;
const FOCAL = new THREE.Vector3(1, 2, 3);

function rig(focusedStar: number | null, focal: THREE.Vector3 | null) {
  const updates: HudUpdateOpts[] = [];
  const visibility: boolean[] = [];
  const hud = {
    update: (opts: HudUpdateOpts) => updates.push({ ...opts }),
    setVisible: (on: boolean) => visibility.push(on),
    setMonochrome: () => {},
    dispose: () => {},
  } as unknown as HudOverlay;
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.Vector3(9, 9, 9);
  const filter: FilterState = { ...DEFAULT_FILTER, showHud: true, sizeMax: 7 };
  const focus = {
    focalLocalPositionInto: (out: THREE.Vector3) => (focal ? (out.copy(focal), true) : false),
    getFocusedStar: () => focusedStar,
    getCameraMode: () => 'observe',
  } as unknown as FocusController;
  const layer = hudSceneLayer({
    hud,
    camera,
    target,
    solIndex: SOL,
    focus,
    filter: () => filter,
    observeProgress: () => ({ f: 0.5, kind: 'enter' }),
    focusedDiscRadiusPx: () => 12,
  });
  return { layer, updates, visibility, camera, target };
}

describe('hudSceneLayer', () => {
  beforeEach(() => { vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('hides the HUD during warp without projecting', () => {
    const { layer, updates, visibility, camera } = rig(null, null);
    layer.update!(makeFrameCtx(camera, { warpActive: true }));
    expect(visibility).toEqual([false]);
    expect(updates).toEqual([]);
  });

  it('projects from the focal position and hides the Sol arrow on Sol focus', () => {
    const { layer, updates, camera, target } = rig(SOL, FOCAL);
    layer.update!(makeFrameCtx(camera));
    const u = updates[0];
    expect(u.focusedLocal?.toArray()).toEqual(FOCAL.toArray());
    expect(u.target).toBe(target);
    expect(u.hideSolArrow).toBe(true);
    expect([u.enabled, u.sizeMaxPx, u.cameraMode, u.focusedDiscRadiusPx, u.w, u.h])
      .toEqual([true, 7, 'observe', 12, 800, 600]);
    expect(u.transition).toEqual({ f: 0.5, kind: 'enter' });
  });

  it('falls back to no focal position, keeping the Sol arrow, when nothing is focused', () => {
    const { layer, updates, camera } = rig(null, null);
    layer.update!(makeFrameCtx(camera));
    expect(updates[0].focusedLocal).toBeNull();
    expect(updates[0].hideSolArrow).toBe(false);
  });
});
