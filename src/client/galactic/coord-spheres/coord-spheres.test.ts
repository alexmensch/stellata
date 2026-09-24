import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { frameAfterFocusChange, type FocusFrameInputs } from '../../attitude/attitude-pure';
import type { Target } from '../../camera/focus/focus-target';
import { fakeChromeLineMaterials } from '../../chrome-lines/chrome-lines-mock';
import { makeFrameCtx } from '../../scene/frame-ctx-mock';
import type { CameraMode } from '../../stellata';
import type { CoordSphereFrame } from './coord-sphere';
import { DRAWN_COORD_SPHERE_FRAMES } from './coord-sphere-frames';
import { CoordSpheres } from './coord-spheres';

const STAR_INPUTS: FocusFrameInputs = { kind: 'star', planetName: null, isSol: false };
const EARTH_INPUTS: FocusFrameInputs = { kind: 'planet', planetName: 'Earth', isSol: false };

function rig() {
  const s = {
    coordSphere: 'none' as CoordSphereFrame,
    mode: 'navigate' as CameraMode,
    inputs: STAR_INPUTS,
    setCalls: [] as CoordSphereFrame[],
    offCalls: 0,
  };
  let focusHandler: ((t: Target | null) => void) | null = null;
  const scene = new THREE.Scene();
  const spheres = new CoordSpheres({
    scene,
    chromeLines: fakeChromeLineMaterials(),
    coordSphere: () => s.coordSphere,
    setCoordSphere: (frame) => { s.setCalls.push(frame); s.coordSphere = frame; },
    cameraMode: () => s.mode,
    focusedTarget: () => null,
    focusFrameInputs: () => s.inputs,
    onFocus: (h) => { focusHandler = h; return () => { s.offCalls++; }; },
  });
  return { s, spheres, scene, focus: (t: Target | null) => focusHandler?.(t) };
}

describe('CoordSpheres', () => {
  it('parents every sphere to the scene', () => {
    const { scene } = rig();
    expect(scene.children).toHaveLength(DRAWN_COORD_SPHERE_FRAMES.length);
  });

  it('draws the selected sphere in observe only', () => {
    const { spheres, s } = rig();
    s.coordSphere = 'ecliptic';
    expect(spheres.drawn('ecliptic')).toBe(false);
    s.mode = 'observe';
    expect(spheres.drawn('ecliptic')).toBe(true);
    expect(spheres.drawn('galactic')).toBe(false);
  });

  it('shows exactly the drawn sphere, and none during warp', () => {
    const { spheres, s, scene } = rig();
    s.coordSphere = 'galactic';
    s.mode = 'observe';
    const camera = new THREE.PerspectiveCamera();
    spheres.entry.update!(makeFrameCtx(camera));
    expect(scene.children.map((g) => g.visible)).toEqual(
      DRAWN_COORD_SPHERE_FRAMES.map((f) => f === 'galactic'));
    spheres.entry.update!(makeFrameCtx(camera, { warpActive: true }));
    expect(scene.children.every((g) => !g.visible)).toBe(true);
  });

  it('offers RA/Dec on Earth alone', () => {
    const { spheres, s } = rig();
    expect(spheres.available('equatorial')).toBe(false);
    s.inputs = EARTH_INPUTS;
    expect(spheres.available('equatorial')).toBe(true);
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

  it('unsubscribes the demotion when the entry disposes', () => {
    const { spheres, s } = rig();
    spheres.entry.dispose();
    expect(s.offCalls).toBe(1);
  });
});
