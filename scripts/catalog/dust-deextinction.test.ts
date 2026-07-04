import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadDustGrid } from './dust-deextinction';

// 2³ grid split into 1³ chunks (8 chunks) so the chunk-placement mapping
// is exercised: each chunk carries a single voxel whose value encodes its
// (ix, iy, iz) index.
function writeFixture(dir: string): void {
  const chunks: Array<{ ix: number; iy: number; iz: number; file: string; bytes: number }> = [];
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        const file = `chunk_${ix}_${iy}_${iz}.bin`;
        const value = ix * 4 + iy * 2 + iz; // distinct per chunk
        writeFileSync(resolve(dir, file), Buffer.from([value]));
        chunks.push({ ix, iy, iz, file, bytes: 1 });
      }
    }
  }
  const manifest = {
    gridSize: 2,
    chunkSize: 1,
    boundsPc: [-100, 100],
    voxelSizePc: 100,
    densityMin: 1e-3,
    densityMax: 0.1,
    avPerDensityPerPc: 2.742,
    chunks,
  };
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest));
}

describe('loadDustGrid', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(resolve(tmpdir(), 'dust-fixture-'));
    writeFixture(dir);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('assembles chunks into an x-fastest global grid', () => {
    const grid = loadDustGrid(dir);
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

  it('hard-fails when the manifest is absent', () => {
    const empty = mkdtempSync(resolve(tmpdir(), 'dust-empty-'));
    expect(() => loadDustGrid(empty)).toThrow(/manifest not found/);
    rmSync(empty, { recursive: true, force: true });
  });
});
