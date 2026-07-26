import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { placeAnchoredLabel, type LabelSurface } from './anchored-label';

function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

function makeLabel(): LabelSurface & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  return {
    attrs,
    style: { display: '\0' },
    setAttribute(name, value) { attrs.set(name, value); },
  };
}

describe('placeAnchoredLabel', () => {
  it('places a label at its anchor plus the offset, on both axes', () => {
    const el = makeLabel();
    // Straight down -Z is view centre, so the anchor projects to the middle
    // of the viewport and the offset is the whole displacement.
    expect(placeAnchoredLabel(el, new THREE.Vector3(0, 0, -1), makeCamera(), 800, 600, 10))
      .toBe(true);
    expect(el.attrs.get('x')).toBe('410.0');
    expect(el.attrs.get('y')).toBe('310.0');
    expect(el.style.display).toBe('');
  });

  it('hides a label whose anchor is behind the camera', () => {
    // Past the near plane the perspective divide flips sign, which would
    // smear the label onto the opposite viewport edge.
    const el = makeLabel();
    expect(placeAnchoredLabel(el, new THREE.Vector3(0, 0, 1), makeCamera(), 800, 600, 10))
      .toBe(false);
    expect(el.style.display).toBe('none');
  });

  it('leaves the previous coordinates untouched when it hides', () => {
    const el = makeLabel();
    const cam = makeCamera();
    placeAnchoredLabel(el, new THREE.Vector3(0, 0, -1), cam, 800, 600, 10);
    placeAnchoredLabel(el, new THREE.Vector3(0, 0, 1), cam, 800, 600, 10);
    expect(el.attrs.get('x')).toBe('410.0');
  });
});
