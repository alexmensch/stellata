import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { StellataRenderer } from '../webgpu/seam';
import { LocalDepthPass, type LocalCluster } from './local-depth-pass';
import {
  computeBracket,
  computeDepthSlices,
  type MemberSphere,
} from './bracket/slice-pure';

interface RenderRecord {
  nearPc: number;
  farPc: number;
}

/** The renderer surface render() touches, recording each bracketed
 *  render's camera planes. `reversedDepth` mocks the WebGPU boot. */
function mockRenderer(reversedDepth: boolean) {
  const renders: RenderRecord[] = [];
  let clearDepthCalls = 0;
  const renderer = {
    autoClear: true,
    getSize: (v: THREE.Vector2) => v.set(1920, 1080),
    clearDepth: () => { clearDepthCalls += 1; },
    render: (_scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
      renders.push({ nearPc: camera.near, farPc: camera.far });
    },
    ...(reversedDepth ? { reversedDepthBuffer: true } : {}),
  };
  return {
    renderer: renderer as unknown as StellataRenderer,
    renders,
    clearDepths: () => clearDepthCalls,
  };
}

function cluster(spheres: MemberSphere[]): LocalCluster {
  return {
    group: new THREE.Group(),
    collectSpheres: (_camera, out) => { out.push(...spheres); },
  };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(50, 16 / 9, 1e-12, 1e5);
}

// Wide enough that the 24-bit sliced path needs several slices.
const WIDE_SPHERES: MemberSphere[] = [
  { distPc: 2e-12, radiusPc: 1e-12 },
  { distPc: 2e-4, radiusPc: 1e-4 },
];

describe('LocalDepthPass.render', () => {
  it('renders one slice per partition entry on the fixed-point path', () => {
    const pass = new LocalDepthPass();
    pass.register(cluster(WIDE_SPHERES));
    const { renderer, renders, clearDepths } = mockRenderer(false);
    const camera = makeCamera();
    pass.render(renderer, camera);
    const expected = computeDepthSlices(
      WIDE_SPHERES, THREE.MathUtils.degToRad(camera.fov), 1080);
    expect(expected.length).toBeGreaterThan(1);
    expect(renders).toEqual(expected);
    expect(clearDepths()).toBe(expected.length);
  });

  it('renders the whole bracket once under reversed-z — the partition retires', () => {
    const pass = new LocalDepthPass();
    pass.register(cluster(WIDE_SPHERES));
    const { renderer, renders, clearDepths } = mockRenderer(true);
    pass.render(renderer, makeCamera());
    expect(renders).toEqual([computeBracket(WIDE_SPHERES)]);
    expect(clearDepths()).toBe(1);
  });

  it('restores camera planes and autoClear on both paths', () => {
    for (const reversed of [false, true]) {
      const pass = new LocalDepthPass();
      pass.register(cluster(WIDE_SPHERES));
      const { renderer } = mockRenderer(reversed);
      const camera = makeCamera();
      pass.render(renderer, camera);
      expect(camera.near).toBe(1e-12);
      expect(camera.far).toBe(1e5);
      expect((renderer as unknown as { autoClear: boolean }).autoClear).toBe(true);
    }
  });

  it('no-ops with no members and while disabled', () => {
    const pass = new LocalDepthPass();
    const empty = mockRenderer(true);
    pass.render(empty.renderer, makeCamera());
    expect(empty.renders).toHaveLength(0);

    pass.register(cluster(WIDE_SPHERES));
    pass.enabled = false;
    const disabled = mockRenderer(true);
    pass.render(disabled.renderer, makeCamera());
    expect(disabled.renders).toHaveLength(0);
  });

  it('issues extraEmptyPasses clears even with no members, none while disabled', () => {
    const pass = new LocalDepthPass();
    pass.extraEmptyPasses = 1;
    const empty = mockRenderer(true);
    pass.render(empty.renderer, makeCamera());
    expect(empty.clearDepths()).toBe(1);
    expect(empty.renders).toHaveLength(0);

    pass.register(cluster(WIDE_SPHERES));
    const withMembers = mockRenderer(true);
    pass.render(withMembers.renderer, makeCamera());
    expect(withMembers.clearDepths()).toBe(2);
    expect(withMembers.renders).toHaveLength(1);

    pass.enabled = false;
    const disabled = mockRenderer(true);
    pass.render(disabled.renderer, makeCamera());
    expect(disabled.clearDepths()).toBe(0);
  });

  it('issues one clear per extraEmptyPasses, so the floor divides out', () => {
    const pass = new LocalDepthPass();
    pass.extraEmptyPasses = 4;
    const empty = mockRenderer(true);
    pass.render(empty.renderer, makeCamera());
    expect(empty.clearDepths()).toBe(4);

    pass.register(cluster(WIDE_SPHERES));
    const withMembers = mockRenderer(true);
    pass.render(withMembers.renderer, makeCamera());
    expect(withMembers.clearDepths()).toBe(5);
    expect(withMembers.renders).toHaveLength(1);
  });
});
