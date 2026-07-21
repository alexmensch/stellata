import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCloudSurfaces } from '../../src/client/molecular-clouds/cloud-surfaces-loader';

const BIN_PATH = resolve(__dirname, '../../data/molecular-clouds/cloud-surfaces.bin');
const CLOUDS_PATH = resolve(__dirname, '../../public/clouds.json');

// Self-skips until both artifacts exist (`pnpm run build:clouds` + the
// offline `build:cloud-surfaces` run).
const ready = existsSync(BIN_PATH) && existsSync(CLOUDS_PATH);

interface RawCloud {
  id: string;
  sid: number;
  center: [number, number, number];
  axes: [number, number, number];
  quat: [number, number, number, number];
  inGrid: boolean;
}

function load() {
  const buf = readFileSync(BIN_PATH);
  const surfaces = parseCloudSurfaces(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  const clouds = (JSON.parse(readFileSync(CLOUDS_PATH, 'utf8')) as { clouds: RawCloud[] })
    .clouds;
  return { surfaces, clouds };
}

/** Ellipsoidal radius of a point in the cloud's local frame (R^T d via
 *  the conjugate quaternion rotation). */
function uEllipsoid(c: RawCloud, x: number, y: number, z: number): number {
  const [qx, qy, qz, qw] = c.quat;
  const dx = x - c.center[0];
  const dy = y - c.center[1];
  const dz = z - c.center[2];
  const cx = qw * dx - qy * dz + qz * dy;
  const cy = qw * dy - qz * dx + qx * dz;
  const cz = qw * dz - qx * dy + qy * dx;
  const cw = qx * dx + qy * dy + qz * dz;
  const lx = cw * qx + cx * qw + cy * qz - cz * qy;
  const ly = cw * qy + cy * qw + cz * qx - cx * qz;
  const lz = cw * qz + cz * qw + cx * qy - cy * qx;
  return Math.sqrt(
    (lx / c.axes[0]) ** 2 + (ly / c.axes[1]) ** 2 + (lz / c.axes[2]) ** 2,
  );
}

describe.skipIf(!ready)('cloud-surfaces.bin (committed artifact)', () => {
  it('pins the traced-surface count (46 of 78 in-grid; the rest keep ellipsoids)', () => {
    const { surfaces } = load();
    expect(surfaces.size).toBe(46);
  });

  it('keys every mesh to an in-grid cloud sid', () => {
    const { surfaces, clouds } = load();
    const inGrid = new Set(clouds.filter((c) => c.inGrid).map((c) => c.sid));
    for (const sid of surfaces.keys()) expect(inGrid.has(sid)).toBe(true);
  });

  it('every mesh is non-degenerate and within the decimation budget', () => {
    const { surfaces } = load();
    for (const s of surfaces.values()) {
      expect(s.positions.length).toBeGreaterThanOrEqual(4 * 3);
      expect(s.indices.length % 3).toBe(0);
      expect(s.indices.length / 3).toBeLessThanOrEqual(2400);
      let maxIdx = 0;
      for (const i of s.indices) if (i > maxIdx) maxIdx = i;
      expect(maxIdx).toBeLessThan(s.positions.length / 3);
    }
  });

  it('every brick is within budget, non-empty, and contains its mesh', () => {
    const { surfaces } = load();
    for (const s of surfaces.values()) {
      const b = s.brick;
      expect(Math.max(...b.dims)).toBeLessThanOrEqual(56);
      expect(b.data.length).toBe(b.dims[0] * b.dims[1] * b.dims[2]);
      expect(b.densityMax).toBeGreaterThan(0);
      expect(b.stepPc).toBeGreaterThan(0);
      // Some texel actually encodes the peak (the linear scale is tight).
      let max = 0;
      for (const v of b.data) if (v > max) max = v;
      expect(max).toBe(255);
      // Every mesh vertex lies inside the brick's world-space AABB —
      // the absorption raymarch can see the dust the rim traces.
      for (let k = 0; k < 3; k++) {
        const hi = b.aabbMinAbs[k] + (b.dims[k] - 1) * b.stepPc;
        for (let i = k; i < s.positions.length; i += 3) {
          expect(s.positions[i]).toBeGreaterThanOrEqual(b.aabbMinAbs[k] - b.stepPc);
          expect(s.positions[i]).toBeLessThanOrEqual(hi + b.stepPc);
        }
      }
    }
  });

  it('winds outward (positive signed volume — the FrontSide cull contract)', () => {
    const { surfaces } = load();
    for (const s of surfaces.values()) {
      // Signed volume about the mesh centroid (translation-invariant for
      // closed meshes; centring avoids float32 cancellation at ~100s pc).
      const n = s.positions.length / 3;
      let cx = 0; let cy = 0; let cz = 0;
      for (let i = 0; i < n; i++) {
        cx += s.positions[i * 3];
        cy += s.positions[i * 3 + 1];
        cz += s.positions[i * 3 + 2];
      }
      cx /= n; cy /= n; cz /= n;
      let vol = 0;
      for (let t = 0; t < s.indices.length; t += 3) {
        const a = s.indices[t] * 3;
        const b = s.indices[t + 1] * 3;
        const c = s.indices[t + 2] * 3;
        const ax = s.positions[a] - cx; const ay = s.positions[a + 1] - cy; const az = s.positions[a + 2] - cz;
        const bx = s.positions[b] - cx; const by = s.positions[b + 1] - cy; const bz = s.positions[b + 2] - cz;
        const gx = s.positions[c] - cx; const gy = s.positions[c + 1] - cy; const gz = s.positions[c + 2] - cz;
        vol += ax * (by * gz - bz * gy) + ay * (bz * gx - bx * gz) + az * (bx * gy - by * gx);
      }
      expect(vol).toBeGreaterThan(0);
    }
  });

  it('every vertex sits inside its cloud envelope (u ≤ 1.1)', () => {
    const { surfaces, clouds } = load();
    const bySid = new Map(clouds.map((c) => [c.sid, c]));
    for (const [sid, s] of surfaces) {
      const cloud = bySid.get(sid)!;
      for (let i = 0; i < s.positions.length; i += 3) {
        const u = uEllipsoid(cloud, s.positions[i], s.positions[i + 1], s.positions[i + 2]);
        expect(u).toBeLessThanOrEqual(1.1);
      }
    }
  });
});
