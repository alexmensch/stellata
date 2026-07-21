import { describe, it, expect } from 'vitest';
import { parseCloudSurfaces } from './cloud-surfaces-loader';

/** Assemble a CSUR buffer from sid-keyed meshes (mirrors the build's
 *  pack_surfaces in scripts/cloud-surfaces/build-cloud-surfaces.py). */
function makeBuffer(
  entries: Array<{ sid: number; positions: number[]; indices: number[] }>,
  version = 1,
): ArrayBuffer {
  const blobBytes = entries.reduce((a, e) => a + e.positions.length * 4 + e.indices.length * 4, 0);
  const buf = new ArrayBuffer(16 + entries.length * 12 + blobBytes);
  const view = new DataView(buf);
  view.setUint32(0, 0x43535552, false); // 'CSUR'
  view.setUint32(4, version, true);
  view.setUint32(8, entries.length, true);
  let off = 16;
  for (const e of entries) {
    view.setUint32(off, e.sid, true);
    view.setUint32(off + 4, e.positions.length / 3, true);
    view.setUint32(off + 8, e.indices.length, true);
    off += 12;
  }
  for (const e of entries) {
    for (const p of e.positions) {
      view.setFloat32(off, p, true);
      off += 4;
    }
    for (const i of e.indices) {
      view.setUint32(off, i, true);
      off += 4;
    }
  }
  return buf;
}

const tri = { sid: 327400, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
const quad = {
  sid: 327401,
  positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
  indices: [0, 1, 2, 0, 2, 3],
};

describe('parseCloudSurfaces', () => {
  it('round-trips a two-cloud buffer keyed by sid', () => {
    const out = parseCloudSurfaces(makeBuffer([tri, quad]));
    expect(out.size).toBe(2);
    const a = out.get(327400)!;
    expect(Array.from(a.positions)).toEqual(tri.positions);
    expect(Array.from(a.indices)).toEqual(tri.indices);
    const b = out.get(327401)!;
    expect(b.positions).toHaveLength(12);
    expect(b.indices).toHaveLength(6);
  });

  it('parses an empty catalog', () => {
    expect(parseCloudSurfaces(makeBuffer([])).size).toBe(0);
  });

  it('throws on a bad magic', () => {
    const buf = makeBuffer([tri]);
    new DataView(buf).setUint32(0, 0x12345678, false);
    expect(() => parseCloudSurfaces(buf)).toThrow(/bad magic/);
  });

  it('throws on an unsupported version', () => {
    expect(() => parseCloudSurfaces(makeBuffer([tri], 2))).toThrow(/unsupported version/);
  });

  it('throws on a truncated buffer', () => {
    const buf = makeBuffer([tri]);
    expect(() => parseCloudSurfaces(buf.slice(0, buf.byteLength - 4))).toThrow(/size mismatch/);
  });
});
