// Assembles the Edenhofer 2024 (/data/papers/index.md#edenhofer2024) dust
// artifact into a DustGrid for the build-time de-extinction integral — README.md.

import type { DustGrid } from './dust-deextinction-pure';

interface DustManifestChunk {
  ix: number;
  iy: number;
  iz: number;
  file: string;
  bytes: number;
}

export interface DustManifest {
  gridSize: number;
  chunkSize: number;
  boundsPc: [number, number];
  voxelSizePc: number;
  densityMin: number;
  densityMax: number;
  avPerDensityPerPc: number;
  chunks: DustManifestChunk[];
}

export function parseDustManifest(text: string): DustManifest {
  return JSON.parse(text) as DustManifest;
}

export function assembleDustGrid(
  manifest: DustManifest,
  readChunk: (file: string) => Uint8Array,
): DustGrid {
  const n = manifest.gridSize;
  const c = manifest.chunkSize;
  const data = new Uint8Array(n * n * n);

  for (const chunk of manifest.chunks) {
    const buf = readChunk(chunk.file);
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
