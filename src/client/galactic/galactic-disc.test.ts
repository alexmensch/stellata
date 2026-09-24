import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fakeChromeLineMaterials } from '../chrome-lines/chrome-lines-mock';
import { makeFrameCtx } from '../scene/frame-ctx-mock';
import { GALACTIC_CENTRE_PC } from './galactic-coords';
import { galacticDiscSceneLayer } from './galactic-disc';

function rig() {
  const s = { permitted: true };
  const scene = new THREE.Scene();
  const worldOffset = new THREE.Vector3();
  const entry = galacticDiscSceneLayer({
    scene,
    chromeLines: fakeChromeLineMaterials(),
    worldOffset,
    detailPermits: () => s.permitted,
  });
  return { s, entry, worldOffset, group: scene.children[0] };
}

function cameraLookingAt(pos: THREE.Vector3, at: THREE.Vector3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1, 1e-3, 1e8);
  camera.position.copy(pos);
  camera.lookAt(at);
  camera.updateMatrixWorld();
  return camera;
}

describe('galacticDiscSceneLayer', () => {
  it('parents the disc to the scene', () => {
    const { group } = rig();
    expect(group).toBeInstanceOf(THREE.Group);
  });

  it('refuses on opacity inside the fade radius, whatever the camera faces', () => {
    const { entry } = rig();
    const c = entry.contribution;
    if (c.kind !== 'gated') throw new Error('disc entry must be gated');
    const camera = cameraLookingAt(new THREE.Vector3(), GALACTIC_CENTRE_PC);
    expect(c.skip(makeFrameCtx(camera, { distFromSol: 0 }))).toBe('opacity');
  });

  it('refuses on the frustum only from outside the disc, looking away', () => {
    const { entry, worldOffset } = rig();
    const c = entry.contribution;
    if (c.kind !== 'gated') throw new Error('disc entry must be gated');
    worldOffset.set(1e6, 0, 0);
    const gcLocal = GALACTIC_CENTRE_PC.clone().sub(worldOffset);
    const away = new THREE.Vector3(0, 0, 0).sub(gcLocal);
    const facing = cameraLookingAt(new THREE.Vector3(), gcLocal);
    const turned = cameraLookingAt(new THREE.Vector3(), away);
    expect(c.skip(makeFrameCtx(facing, { distFromSol: 1e6 }))).toBeNull();
    expect(c.skip(makeFrameCtx(turned, { distFromSol: 1e6 }))).toBe('frustum');
  });

  it('rebases the disc only when the declutter floor permits and no warp runs', () => {
    const { entry, s, worldOffset, group } = rig();
    const camera = new THREE.PerspectiveCamera();
    worldOffset.set(3, 0, 0);
    entry.update!(makeFrameCtx(camera, { worldOffset }));
    expect(group.visible).toBe(true);
    expect(group.position.x).toBe(-3);
    entry.update!(makeFrameCtx(camera, { worldOffset, warpActive: true }));
    expect(group.visible).toBe(false);
    s.permitted = false;
    entry.update!(makeFrameCtx(camera, { worldOffset }));
    expect(group.visible).toBe(false);
  });
});
