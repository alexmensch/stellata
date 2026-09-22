import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fakeChromeLineMaterials } from '../chrome-lines/chrome-lines-mock';
import { SHELL_RIM_BLUE } from '../fresnel-shell/fresnel-shell';
import {
  makeOrbitLineLoop,
  makeOrbitRingSegments,
  ORBIT_LINE_COLOUR,
  writeRingVerts,
} from './orbit-line';

function ring(vertexCount: number): Float32Array {
  const pts = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const a = (i / vertexCount) * Math.PI * 2;
    pts[i * 3] = Math.cos(a);
    pts[i * 3 + 1] = Math.sin(a);
  }
  return pts;
}

const stroke = fakeChromeLineMaterials().solid(0xffffff, 0.5);
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

describe('makeOrbitRingSegments', () => {
  const rings = (ringCount: number, segments: number) => {
    const pts = new Float32Array(ringCount * segments * 3);
    return makeOrbitRingSegments(pts, segments, stroke.material, 3);
  };

  it('closes each ring on its own base, so no segment spans two rings', () => {
    const index = rings(3, 8).geometry.getIndex()!;
    expect(index.count).toBe(3 * 8 * 2);
    for (let ring = 0; ring < 3; ring++) {
      const base = ring * 8;
      const last = (base + 7) * 2;
      expect(index.getX(last)).toBe(base + 7);
      expect(index.getX(last + 1)).toBe(base);
    }
  });

  it('keeps one vertex per corner where the un-indexed form duplicates', () => {
    const line = rings(3, 8);
    expect(line.geometry.getAttribute('position').count).toBe(24);
    expect(line.geometry.getIndex()!.count).toBe(48);
  });

  it('widens the index on the vertices addressed, not the entry count', () => {
    // 40k vertices need 80k entries and still index in 16 bits; the ceiling
    // is the vertex a single entry can reach.
    expect(rings(500, 80).geometry.getIndex()!.array).toBeInstanceOf(Uint16Array);
    expect(rings(1000, 80).geometry.getIndex()!.array).toBeInstanceOf(Uint32Array);
  });
});

describe('writeRingVerts', () => {
  const sweep = (plane: 'xy' | 'xz' | 'yz', offset: number) => {
    const out = new Float32Array(4 * 3);
    writeRingVerts({ radiusA: 2, radiusB: 3, plane, offset }, 4, () => {}, out, 0);
    return out;
  };

  const expectVerts = (got: Float32Array, want: number[]) => {
    want.forEach((w, i) => expect(got[i]).toBeCloseTo(w, 5));
  };

  it('sweeps the two axes the plane names and offsets along the third', () => {
    // Quarter turns: vertex 0 is radiusA on the cosine leg, vertex 1 is
    // radiusB on the sine leg, and the offset holds on the third axis.
    expectVerts(sweep('xy', 7), [2, 0, 7, 0, 3, 7]);
    expectVerts(sweep('xz', 7), [2, 7, 0, 0, 7, 3]);
    expectVerts(sweep('yz', 7), [7, 2, 0, 7, 0, 3]);
  });

  it('returns the next write offset so rings pack end to end', () => {
    const out = new Float32Array(8 * 3);
    const spec = { radiusA: 1, radiusB: 1, plane: 'xy' as const, offset: 0 };
    const at = writeRingVerts(spec, 4, () => {}, out, 0);
    expect(at).toBe(12);
    expect(writeRingVerts(spec, 4, () => {}, out, at)).toBe(24);
  });

  it('carries every vertex through `place` on the way into the buffer', () => {
    const out = new Float32Array(4 * 3);
    writeRingVerts(
      { radiusA: 1, radiusB: 1, plane: 'xy', offset: 0 }, 4,
      (v) => { v.multiplyScalar(10).add(new THREE.Vector3(0, 0, 5)); }, out, 0);
    expectVerts(out, [10, 0, 5]);
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
