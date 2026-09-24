import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { frameAfterFocusChange, type FocusFrameInputs } from '../attitude/attitude-pure';
import type { Target } from '../camera/focus/focus-target';
import { fakeChromeLineMaterials } from '../chrome-lines/chrome-lines-mock';
import { makeFrameCtx } from '../scene/frame-ctx-mock';
import type { CameraMode } from '../stellata';
import type { CoordSphereFrame } from './coord-spheres/coord-sphere';
import { DRAWN_COORD_SPHERE_FRAMES } from './coord-spheres/coord-sphere-frames';
import { GALACTIC_CENTRE_PC } from './galactic-coords';
import type { GalacticDisc } from './galactic-disc';
import { GalacticReference } from './galactic-reference';

const STAR_INPUTS: FocusFrameInputs = { kind: 'star', planetName: null, isSol: false };
const EARTH_INPUTS: FocusFrameInputs = { kind: 'planet', planetName: 'Earth', isSol: false };

function rig() {
  const s = {
    coordSphere: 'none' as CoordSphereFrame,
    mode: 'navigate' as CameraMode,
    inputs: STAR_INPUTS,
    permitted: true,
    discUpdates: 0,
    setCalls: [] as CoordSphereFrame[],
    offCalls: 0,
  };
  let focusHandler: ((t: Target | null) => void) | null = null;
  const disc = {
    group: new THREE.Group(),
    update: () => { s.discUpdates++; },
    setMonochrome: () => {},
    dispose: () => {},
  } as unknown as GalacticDisc;
  const worldOffset = new THREE.Vector3();
  const scene = new THREE.Scene();
  const ref = new GalacticReference({
    disc,
    scene,
    chromeLines: fakeChromeLineMaterials(),
    worldOffset,
    detailPermits: () => s.permitted,
    coordSphere: () => s.coordSphere,
    setCoordSphere: (frame) => { s.setCalls.push(frame); s.coordSphere = frame; },
    cameraMode: () => s.mode,
    focusedTarget: () => null,
    focusFrameInputs: () => s.inputs,
    onFocus: (h) => { focusHandler = h; return () => { s.offCalls++; }; },
  });
  return { s, ref, disc, scene, worldOffset, focus: (t: Target | null) => focusHandler?.(t) };
}

function cameraLookingAt(pos: THREE.Vector3, at: THREE.Vector3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 1, 1e-3, 1e8);
  camera.position.copy(pos);
  camera.lookAt(at);
  camera.updateMatrixWorld();
  return camera;
}

describe('GalacticReference disc entry', () => {
  it('refuses on opacity inside the fade radius, whatever the camera faces', () => {
    const { ref } = rig();
    const c = ref.discEntry.contribution;
    if (c.kind !== 'gated') throw new Error('disc entry must be gated');
    const camera = cameraLookingAt(new THREE.Vector3(), GALACTIC_CENTRE_PC);
    expect(c.skip(makeFrameCtx(camera, { distFromSol: 0 }))).toBe('opacity');
  });

  it('refuses on the frustum only from outside the disc, looking away', () => {
    const { ref, worldOffset } = rig();
    const c = ref.discEntry.contribution;
    if (c.kind !== 'gated') throw new Error('disc entry must be gated');
    worldOffset.set(1e6, 0, 0);
    const gcLocal = GALACTIC_CENTRE_PC.clone().sub(worldOffset);
    const away = new THREE.Vector3(0, 0, 0).sub(gcLocal);
    const facing = cameraLookingAt(new THREE.Vector3(), gcLocal);
    const turned = cameraLookingAt(new THREE.Vector3(), away);
    expect(c.skip(makeFrameCtx(facing, { distFromSol: 1e6 }))).toBeNull();
    expect(c.skip(makeFrameCtx(turned, { distFromSol: 1e6 }))).toBe('frustum');
  });

  it('updates the disc only when the declutter floor permits and no warp runs', () => {
    const { ref, s, disc } = rig();
    const camera = new THREE.PerspectiveCamera();
    ref.discEntry.update!(makeFrameCtx(camera));
    expect(s.discUpdates).toBe(1);
    ref.discEntry.update!(makeFrameCtx(camera, { warpActive: true }));
    s.permitted = false;
    ref.discEntry.update!(makeFrameCtx(camera));
    expect(s.discUpdates).toBe(1);
    expect(disc.group.visible).toBe(false);
  });
});

describe('GalacticReference coordinate spheres', () => {
  it('parents every sphere to the scene', () => {
    const { scene } = rig();
    expect(scene.children).toHaveLength(DRAWN_COORD_SPHERE_FRAMES.length);
  });

  it('draws the selected sphere in observe only', () => {
    const { ref, s } = rig();
    s.coordSphere = 'ecliptic';
    expect(ref.coordSphereDrawn('ecliptic')).toBe(false);
    s.mode = 'observe';
    expect(ref.coordSphereDrawn('ecliptic')).toBe(true);
    expect(ref.coordSphereDrawn('galactic')).toBe(false);
  });

  it('shows exactly the drawn sphere, and none during warp', () => {
    const { ref, s, scene } = rig();
    s.coordSphere = 'galactic';
    s.mode = 'observe';
    const camera = new THREE.PerspectiveCamera();
    ref.coordSpheresEntry.update!(makeFrameCtx(camera));
    expect(scene.children.map((g) => g.visible)).toEqual(
      DRAWN_COORD_SPHERE_FRAMES.map((f) => f === 'galactic'));
    ref.coordSpheresEntry.update!(makeFrameCtx(camera, { warpActive: true }));
    expect(scene.children.every((g) => !g.visible)).toBe(true);
  });

  it('offers RA/Dec on Earth alone', () => {
    const { ref, s } = rig();
    expect(ref.coordSphereAvailable('equatorial')).toBe(false);
    s.inputs = EARTH_INPUTS;
    expect(ref.coordSphereAvailable('equatorial')).toBe(true);
  });

  it('demotes a frame the new focus gives no meaning to, and only then', () => {
    const { s, focus } = rig();
    s.coordSphere = 'galactic';
    focus(null);
    expect(s.setCalls).toEqual([]);
    s.coordSphere = 'equatorial';
    focus(null);
    const expected = frameAfterFocusChange('equatorial', STAR_INPUTS);
    expect(expected).not.toBe('equatorial');
    expect(s.setCalls).toEqual([expected]);
  });

  it('unsubscribes the demotion when the sphere entry disposes', () => {
    const { ref, s } = rig();
    ref.coordSpheresEntry.dispose();
    expect(s.offCalls).toBe(1);
  });
});
