import { describe, expect, it } from 'vitest';
import { parseLocalBubble } from './local-bubble-loader';

function buildBuffer(
  positions: number[],
  indices: number[],
  centroid: [number, number, number],
): ArrayBuffer {
  const vertexCount = positions.length / 3;
  const buf = new ArrayBuffer(32 + positions.length * 4 + indices.length * 4);
  const view = new DataView(buf);
  view.setUint8(0, 0x4c); // L
  view.setUint8(1, 0x42); // B
  view.setUint8(2, 0x55); // U
  view.setUint8(3, 0x42); // B
  view.setUint32(4, 1, true); // version
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, indices.length, true);
  view.setFloat32(16, centroid[0], true);
  view.setFloat32(20, centroid[1], true);
  view.setFloat32(24, centroid[2], true);
  let o = 32;
  for (const p of positions) { view.setFloat32(o, p, true); o += 4; }
  for (const i of indices) { view.setUint32(o, i, true); o += 4; }
  return buf;
}

describe('parseLocalBubble', () => {
  it('round-trips positions and indices past the reserved header', () => {
    // Centroid bytes (16–27) are written but reserved — the parser skips
    // them; positions/indices must still read back exactly.
    const buf = buildBuffer([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], [8, 10, -7]);
    const m = parseLocalBubble(buf);
    expect(Array.from(m.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(m.indices)).toEqual([0, 1, 2]);
  });

  it('rejects a bad magic', () => {
    const buf = buildBuffer([0, 0, 0], [], [0, 0, 0]);
    new DataView(buf).setUint8(0, 0x58); // corrupt L -> X
    expect(() => parseLocalBubble(buf)).toThrow(/magic/);
  });

  it('rejects a size mismatch', () => {
    const buf = buildBuffer([0, 0, 0], [0], [0, 0, 0]);
    // Claim two indices where only one is present.
    new DataView(buf).setUint32(12, 2, true);
    expect(() => parseLocalBubble(buf)).toThrow(/size mismatch/);
  });
});
