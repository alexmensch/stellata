import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  Heliopause,
  HELIOPAUSE_APEX_SOL_PC,
  HELIOPAUSE_LABEL_ELEMENT_ID,
  HELIOPAUSE_SAMPLE_POINTS_SOL,
} from '../solar-system/heliopause/heliopause';
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

// The real heliopause: the pick surface is the mesh the layer draws, its
// FrontSide material and its group transform, not a stand-in.
function heliopauseSurface(): ShellPickSurface {
  const shell = new Heliopause();
  shell.group.updateMatrixWorld(true);
  return shell.shellPickSurface();
}

// Camera parked far outside the shell along the apex axis, looking back
// at Sol — the apex lands on the view axis (screen centre) and the whole
// shell subtends only a few degrees.
function outsideShellCamera(): THREE.PerspectiveCamera {
  const camPos = HELIOPAUSE_APEX_SOL_PC.clone().normalize()
    .multiplyScalar(HELIOPAUSE_APEX_SOL_PC.length() * 20);
  const cam = new THREE.PerspectiveCamera(FOV_DEG, VIEWPORT_W / VIEWPORT_H, 1e-10, 1e6);
  cam.position.copy(camPos);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

// Camera at Sol — inside the shell, the common near view.
function insideShellCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(FOV_DEG, VIEWPORT_W / VIEWPORT_H, 1e-10, 1e6);
  cam.position.set(0, 0, 0);
  cam.lookAt(HELIOPAUSE_APEX_SOL_PC);
  cam.updateMatrixWorld();
  return cam;
}

/** The screen-space bounding box of the projected silhouette samples —
 *  the surface this pick used to be. Its corners are what the acceptance
 *  case below aims at. */
function sampleBbox(camera: THREE.PerspectiveCamera) {
  const v = new THREE.Vector3();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of HELIOPAUSE_SAMPLE_POINTS_SOL) {
    v.copy(s).project(camera);
    const sx = (v.x + 1) * 0.5 * VIEWPORT_W;
    const sy = (1 - v.y) * 0.5 * VIEWPORT_H;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  return { minX, minY, maxX, maxY };
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

function pick(
  surface: ShellPickSurface,
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
) {
  return pickShellSilhouette({
    camera,
    rect,
    clientX: x,
    clientY: y,
    surface,
    cameraDistancePc: 42,
    idx: 1,
  });
}

describe('pickShellSilhouette', () => {
  it('outside-shell: cursor on the drawn silhouette → extended hit', () => {
    withDocumentStub(() => null, () => {
      const hit = pick(heliopauseSurface(), outsideShellCamera(), VIEWPORT_W / 2, VIEWPORT_H / 2);
      expect(hit).not.toBeNull();
      expect(hit!.tier).toBe('extended');
      expect(hit!.idx).toBe(1);
      expect(hit!.cameraDistancePc).toBe(42);
    });
  });

  it('outside-shell: cursor far from the silhouette → miss', () => {
    withDocumentStub(() => null, () => {
      expect(pick(heliopauseSurface(), outsideShellCamera(), 2, 2)).toBeNull();
    });
  });

  // The acceptance case. The shell is rounded, so the corners of its
  // projected bounding box are empty sky — and clicking empty sky used to
  // select "Heliopause".
  it('outside-shell: the bbox corner the old surface reached is empty sky now', () => {
    withDocumentStub(() => null, () => {
      const camera = outsideShellCamera();
      const box = sampleBbox(camera);
      const surface = heliopauseSurface();
      // A pixel inside the box on both axes: the old test was
      // cursor-in-rect, so this was a hit by construction.
      expect(box.maxX - box.minX).toBeGreaterThan(20);
      expect(pick(surface, camera, box.minX + 1, box.minY + 1)).toBeNull();
      expect(pick(surface, camera, box.maxX - 1, box.minY + 1)).toBeNull();
      expect(pick(surface, camera, box.minX + 1, box.maxY - 1)).toBeNull();
      expect(pick(surface, camera, box.maxX - 1, box.maxY - 1)).toBeNull();
    });
  });

  // No near-plane bail does this any more: the material is FrontSide, so
  // the ray meets only the far wall's culled back faces.
  it('inside-shell: the FrontSide cull leaves nothing to hit', () => {
    withDocumentStub(() => null, () => {
      expect(
        pick(heliopauseSurface(), insideShellCamera(), VIEWPORT_W / 2, VIEWPORT_H / 2),
      ).toBeNull();
    });
  });

  it('inside-shell: label bbox overlap still extended-hits though the mesh missed', () => {
    const labelRect = {
      left: 100, top: 100, right: 140, bottom: 120, width: 40, height: 20,
    } as DOMRect;
    withDocumentStub(
      (id) => (id === HELIOPAUSE_LABEL_ELEMENT_ID
        ? { getBoundingClientRect: () => labelRect }
        : null),
      () => {
        const hit = pick(heliopauseSurface(), insideShellCamera(), 120, 110);
        expect(hit).not.toBeNull();
        expect(hit!.tier).toBe('extended');
      },
    );
  });

  it('a shell with no mesh yet answers on the label alone', () => {
    const noMesh: ShellPickSurface = {
      labelElementId: 'x',
      visible: () => true,
      mesh: () => null,
    };
    withDocumentStub(() => null, () => {
      expect(pick(noMesh, outsideShellCamera(), VIEWPORT_W / 2, VIEWPORT_H / 2)).toBeNull();
    });
  });
});
