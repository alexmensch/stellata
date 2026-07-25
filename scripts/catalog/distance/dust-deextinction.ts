// Loads the LFS-committed Edenhofer dust artifact (data/dust/) into a
// DustGrid for the build-time de-extinction integral. See
// scripts/catalog/README.md § Build-time de-extinction.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { DustGrid } from './dust-deextinction-pure';

interface DustManifestChunk {
  ix: number;
  iy: number;
  iz: number;
  file: string;
  bytes: number;
}

interface DustManifest {
  gridSize: number;
  chunkSize: number;
  boundsPc: [number, number];
  voxelSizePc: number;
  densityMin: number;
  densityMax: number;
  avPerDensityPerPc: number;
  chunks: DustManifestChunk[];
}

export function loadDustGrid(dustDir: string): DustGrid {
  const manifestPath = resolve(dustDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Dust manifest not found at ${manifestPath}. The build-time ` +
        `de-extinction integral requires the Edenhofer dust artifact — ` +
        `pull LFS (git lfs pull) or run scripts/dust/build-dust.py.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DustManifest;
  const n = manifest.gridSize;
  const c = manifest.chunkSize;
  const data = new Uint8Array(n * n * n);

  for (const chunk of manifest.chunks) {
    const chunkPath = resolve(dustDir, chunk.file);
    if (!existsSync(chunkPath)) {
      throw new Error(`Dust chunk missing: ${chunkPath} (git lfs pull?)`);
    }
    const buf = readFileSync(chunkPath);
    if (buf.length !== chunk.bytes) {
      throw new Error(
        `Dust chunk size mismatch for ${chunk.file}: got ${buf.length}, ` +
          `manifest says ${chunk.bytes}.`,
      );
    }
    // Chunk bytes are x-fastest within (iz, iy, ix) — the Python writer's
    // transpose(2,1,0). The global grid is x-fastest too, so each
    // x-contiguous run of c voxels copies as one span.
    for (let liz = 0; liz < c; liz++) {
      const gz = chunk.iz * c + liz;
      for (let liy = 0; liy < c; liy++) {
        const gy = chunk.iy * c + liy;
        const srcOff = (liz * c + liy) * c;
        const dstOff = (gz * n + gy) * n + chunk.ix * c;
        data.set(buf.subarray(srcOff, srcOff + c), dstOff);
      }
    }
  }

  return {
    gridSize: n,
    boundsHalfPc: Math.abs(manifest.boundsPc[1]),
    densityMin: manifest.densityMin,
    logRatio: Math.log(manifest.densityMax / manifest.densityMin),
    avPerDensityPc: manifest.avPerDensityPerPc,
    voxelSizePc: manifest.voxelSizePc,
    data,
  };
}
