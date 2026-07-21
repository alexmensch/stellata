import { describe, it, expect } from 'vitest';
import { parseCloudSurfaces } from './cloud-surfaces-loader';

interface TestEntry {
  sid: number;
  positions: number[];
  indices: number[];
  brick: {
    dims: [number, number, number];
    aabbMin: [number, number, number];
    stepPc: number;
    densityMax: number;
    data: number[];
  };
}

/** Assemble a CSUR v2 buffer from sid-keyed meshes (mirrors the writer
 *  in scripts/cloud-surfaces/build-cloud-surfaces.py). */
function makeBuffer(entries: TestEntry[], version = 2): ArrayBuffer {
  const blobBytes = entries.reduce(
    (a, e) => a + e.positions.length * 4 + e.indices.length * 4 + e.brick.data.length, 0);
  const buf = new ArrayBuffer(16 + entries.length * 44 + blobBytes);
  const view = new DataView(buf);
  view.setUint32(0, 0x43535552, false); // 'CSUR'
  view.setUint32(4, version, true);
  view.setUint32(8, entries.length, true);
  let off = 16;
  for (const e of entries) {
    view.setUint32(off, e.sid, true);
    view.setUint32(off + 4, e.positions.length / 3, true);
    view.setUint32(off + 8, e.indices.length, true);
    for (let k = 0; k < 3; k++) view.setUint32(off + 12 + k * 4, e.brick.dims[k], true);
    for (let k = 0; k < 3; k++) view.setFloat32(off + 24 + k * 4, e.brick.aabbMin[k], true);
    view.setFloat32(off + 36, e.brick.stepPc, true);
    view.setFloat32(off + 40, e.brick.densityMax, true);
    off += 44;
  }
  const bytes = new Uint8Array(buf);
  for (const e of entries) {
    for (const p of e.positions) {
      view.setFloat32(off, p, true);
      off += 4;
    }
    for (const i of e.indices) {
      view.setUint32(off, i, true);
      off += 4;
    }
    bytes.set(e.brick.data, off);
    off += e.brick.data.length;
  }
  return buf;
}

const brick2 = {
  dims: [2, 1, 1] as [number, number, number],
  aabbMin: [-5, -5, -5] as [number, number, number],
  stepPc: 5,
  densityMax: 0.05,
  data: [255, 128],
};
const tri = {
  sid: 327400,
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  brick: brick2,
};
const quad = {
  sid: 327401,
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  indices: [0, 1, 2, 0, 2, 3],
  brick: { ...brick2, dims: [1, 1, 1] as [number, number, number], data: [7] },
};

describe('parseCloudSurfaces', () => {
  it('round-trips a two-cloud buffer keyed by sid, bricks included', () => {
    const out = parseCloudSurfaces(makeBuffer([tri, quad]));
    expect(out.size).toBe(2);
    const a = out.get(327400)!;
    expect(Array.from(a.positions)).toEqual(tri.positions);
    expect(Array.from(a.indices)).toEqual(tri.indices);
    expect(a.brick.dims).toEqual([2, 1, 1]);
    expect(a.brick.aabbMinAbs).toEqual([-5, -5, -5]);
    expect(a.brick.stepPc).toBe(5);
    expect(a.brick.densityMax).toBeCloseTo(0.05, 7);
    expect(Array.from(a.brick.data)).toEqual([255, 128]);
    const b = out.get(327401)!;
    expect(b.positions).toHaveLength(12);
    expect(b.indices).toHaveLength(6);
    expect(Array.from(b.brick.data)).toEqual([7]);
  });

  it('parses an empty catalog', () => {
    expect(parseCloudSurfaces(makeBuffer([])).size).toBe(0);
  });

  it('throws on a bad magic', () => {
    const buf = makeBuffer([tri]);
    new DataView(buf).setUint32(0, 0x12345678, false);
    expect(() => parseCloudSurfaces(buf)).toThrow(/bad magic/);
  });

  it('throws on an unsupported version (a stale v1 binary must not half-parse)', () => {
    expect(() => parseCloudSurfaces(makeBuffer([tri], 1))).toThrow(/unsupported version/);
  });

  it('throws on a truncated buffer', () => {
    const buf = makeBuffer([tri]);
    expect(() => parseCloudSurfaces(buf.slice(0, buf.byteLength - 4))).toThrow(/size mismatch/);
  });
});
