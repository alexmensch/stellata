import { describe, it, expect } from 'vitest';
import { assembleDustGrid, type DustManifest } from './dust-deextinction';

// 2³ grid split into 1³ chunks (8 chunks) so the chunk-placement mapping
// is exercised: each chunk carries a single voxel whose value encodes its
// (ix, iy, iz) index.
function fixture(): { manifest: DustManifest; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const chunks: DustManifest['chunks'] = [];
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        const file = `chunk_${ix}_${iy}_${iz}.bin`;
        const value = ix * 4 + iy * 2 + iz; // distinct per chunk
        files.set(file, Uint8Array.from([value]));
        chunks.push({ ix, iy, iz, file, bytes: 1 });
      }
    }
  }
  const manifest: DustManifest = {
    gridSize: 2,
    chunkSize: 1,
    boundsPc: [-100, 100],
    voxelSizePc: 100,
    densityMin: 1e-3,
    densityMax: 0.1,
    avPerDensityPerPc: 2.742,
    chunks,
  };
  return { manifest, files };
}

describe('assembleDustGrid', () => {
  it('assembles chunks into an x-fastest global grid', () => {
    const { manifest, files } = fixture();
    const grid = assembleDustGrid(manifest, (f) => files.get(f)!);
    expect(grid.gridSize).toBe(2);
    expect(grid.boundsHalfPc).toBe(100);
    expect(grid.avPerDensityPc).toBe(2.742);
    expect(grid.logRatio).toBeCloseTo(Math.log(0.1 / 1e-3), 12);
    // Each voxel at global (gx=ix, gy=iy, gz=iz) must carry its chunk value.
    for (let ix = 0; ix < 2; ix++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let iz = 0; iz < 2; iz++) {
          const idx = (iz * 2 + iy) * 2 + ix;
          expect(grid.data[idx]).toBe(ix * 4 + iy * 2 + iz);
        }
      }
    }
  });
});
