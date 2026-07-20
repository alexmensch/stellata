import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  HELIOPAUSE_APEX_SOL_PC,
  HELIOPAUSE_LABEL_ELEMENT_ID,
  HELIOPAUSE_SAMPLE_POINTS_SOL,
} from '../solar-system/heliopause';
import { pickShellSilhouette } from './shell-pick';
import type { ShellPickSurface } from './shell-registry';

const VIEWPORT_W = 800;
const VIEWPORT_H = 600;
const FOV_DEG = 60;

const rect = {
  left: 0,
  top: 0,
  width: VIEWPORT_W,
  height: VIEWPORT_H,
  right: VIEWPORT_W,
  bottom: VIEWPORT_H,
  x: 0,
  y: 0,
  toJSON() {
    return {};
  },
} as DOMRect;

// Pick surface backed by the real heliopause silhouette samples.
const surface: ShellPickSurface = {
  labelElementId: HELIOPAUSE_LABEL_ELEMENT_ID,
  visible: () => true,
  sampleCount: () => HELIOPAUSE_SAMPLE_POINTS_SOL.length,
  sampleLocalInto: (i, worldOffset, out) => {
    out.copy(HELIOPAUSE_SAMPLE_POINTS_SOL[i]).sub(worldOffset);
  },
};

// Camera parked far outside the shell along the apex axis, looking back
// at Sol — the apex sample lands on the view axis (screen centre) and the
// whole shell subtends only a few degrees, so every sample projects in
// front of the near plane.
function outsideShellCamera(): THREE.PerspectiveCamera {
  const camPos = HELIOPAUSE_APEX_SOL_PC.clone().normalize()
    .multiplyScalar(HELIOPAUSE_APEX_SOL_PC.length() * 20);
  const cam = new THREE.PerspectiveCamera(FOV_DEG, VIEWPORT_W / VIEWPORT_H, 1e-10, 1e6);
  cam.position.copy(camPos);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

// Camera at Sol (shell interior) — samples on the far wall land behind the
// camera, tripping the near-plane bail.
function insideShellCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(FOV_DEG, VIEWPORT_W / VIEWPORT_H, 1e-10, 1e6);
  cam.position.set(0, 0, 0);
  cam.lookAt(HELIOPAUSE_APEX_SOL_PC);
  cam.updateMatrixWorld();
  return cam;
}

function withDocumentStub(getElementById: (id: string) => unknown, fn: () => void): void {
  const prev = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { getElementById };
  try {
    fn();
  } finally {
    (globalThis as { document?: unknown }).document = prev;
  }
}

function pick(camera: THREE.PerspectiveCamera, x: number, y: number) {
  return pickShellSilhouette({
    camera,
    rect,
    clientX: x,
    clientY: y,
    worldOffset: new THREE.Vector3(),
    surface,
    cameraDistancePc: 42,
    idx: 1,
    scratch: new THREE.Vector3(),
  });
}

describe('pickShellSilhouette', () => {
  it('outside-shell: cursor inside the projected silhouette bbox → fallback hit', () => {
    withDocumentStub(() => null, () => {
      const hit = pick(outsideShellCamera(), VIEWPORT_W / 2, VIEWPORT_H / 2);
      expect(hit).not.toBeNull();
      expect(hit!.tier).toBe('fallback');
      expect(hit!.idx).toBe(1);
      expect(hit!.cameraDistancePc).toBe(42);
    });
  });

  it('outside-shell: cursor far from the silhouette → miss', () => {
    withDocumentStub(() => null, () => {
      expect(pick(outsideShellCamera(), 2, 2)).toBeNull();
    });
  });

  it('inside-shell: a sample behind the near plane bails the silhouette test', () => {
    withDocumentStub(() => null, () => {
      expect(pick(insideShellCamera(), VIEWPORT_W / 2, VIEWPORT_H / 2)).toBeNull();
    });
  });

  it('inside-shell: label bbox overlap still fallback-hits though the silhouette bailed', () => {
    const labelRect = {
      left: 100, top: 100, right: 140, bottom: 120, width: 40, height: 20,
    } as DOMRect;
    withDocumentStub(
      (id) => (id === HELIOPAUSE_LABEL_ELEMENT_ID
        ? { getBoundingClientRect: () => labelRect }
        : null),
      () => {
        const hit = pick(insideShellCamera(), 120, 110);
        expect(hit).not.toBeNull();
        expect(hit!.tier).toBe('fallback');
      },
    );
  });
});
