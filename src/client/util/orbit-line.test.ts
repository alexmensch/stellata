import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { builtinChromeLineMaterials } from '../chrome-lines/builtin-chrome-lines';
import { SHELL_RIM_BLUE } from '../fresnel-shell/fresnel-shell';
import { makeOrbitLineLoop, ORBIT_LINE_COLOUR } from './orbit-line';

function ring(vertexCount: number): Float32Array {
  const pts = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const a = (i / vertexCount) * Math.PI * 2;
    pts[i * 3] = Math.cos(a);
    pts[i * 3 + 1] = Math.sin(a);
  }
  return pts;
}

const stroke = builtinChromeLineMaterials().solid(0xffffff, 0.5);
const loop = (n: number) => makeOrbitLineLoop(ring(n), stroke.material, 3);

describe('makeOrbitLineLoop', () => {
  it('closes the ring through the index, not a LineLoop primitive', () => {
    // WebGPU has no line-loop primitive and the renderer refuses the
    // object outright, so the closing segment is an index entry back to
    // vertex 0 on a plain Line.
    const line = loop(64);
    expect(line.type).toBe('Line');
    expect((line as { isLineLoop?: boolean }).isLineLoop).toBeUndefined();
    const index = line.geometry.getIndex()!;
    expect(index.count).toBe(65);
    expect(index.getX(0)).toBe(0);
    expect(index.getX(63)).toBe(63);
    expect(index.getX(64)).toBe(0);
  });

  it('leaves the position buffer at exactly the points it was given', () => {
    // Per-frame vertex rewrites and the anchored-line rebake address this
    // buffer by vertex index; a duplicated closing vertex would put every
    // writer one slot out of step with its float64 master.
    const line = loop(64);
    expect(line.geometry.getAttribute('position').count).toBe(64);
  });

  it('widens the index past the Uint16 vertex ceiling', () => {
    expect(loop(64).geometry.getIndex()!.array).toBeInstanceOf(Uint16Array);
    expect(loop(70_000).geometry.getIndex()!.array).toBeInstanceOf(Uint32Array);
  });
});

describe('ORBIT_LINE_COLOUR', () => {
  // LinearSRGB keeps the authored bytes verbatim: these are hex values a
  // reader picks off the screen, and the sRGB decode moves each one's hue
  // by a different couple of degrees.
  const hueDeg = (hex: number) =>
    new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace)
      .getHSL({ h: 0, s: 0, l: 0 }, THREE.LinearSRGBColorSpace).h * 360;

  it('is the one stroke colour the local scene draws its chrome in', () => {
    expect(ORBIT_LINE_COLOUR).toBe(0x88aacc);
  });

  // The constant's comment claims the shared hue; the three consumers that
  // each authored their own blue had drifted to 202-208 deg before it was
  // hoisted, so the two sides are pinned rather than compared loosely.
  it('sits on the fresnel shells hue', () => {
    expect(hueDeg(ORBIT_LINE_COLOUR)).toBeCloseTo(210.0, 1);
    expect(hueDeg(SHELL_RIM_BLUE)).toBeCloseTo(210.9, 1);
  });
});
