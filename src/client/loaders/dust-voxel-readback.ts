// Reading voxels back off the GPU and checking them against the chunk
// files they came from — the numeric smoke for the streaming upload.
// See README.md § Dust voxel readback.

import type * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { StellataRenderer } from '../webgpu/seam';
import { closestChunksFirst, type DustChunkMeta, type DustManifest } from './dust-loader';
import { glTextureOf, isWebGpuRenderer } from './dust-voxel-upload';

/** Voxels per read. WebGPU rejects a buffer mapping whose range is not a
 *  multiple of 4 bytes, so a single-texel readback is not available on that
 *  backend and both paths read a run of 4 along x instead. */
export const VOXEL_RUN = 4;

/** Reads `VOXEL_RUN` voxels along x, starting at the given voxel. */
export type VoxelReader = (x: number, y: number, z: number) => Promise<Uint8Array>;

export function createVoxelReader(
  renderer: StellataRenderer,
  texture: THREE.Data3DTexture,
): VoxelReader {
  return isWebGpuRenderer(renderer)
    ? webGpuVoxelReader(renderer, texture)
    : glVoxelReader(renderer, texture);
}

function glVoxelReader(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Data3DTexture,
): VoxelReader {
  return async (x, y, z) => {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const glTex = glTextureOf(renderer, texture);
    if (!glTex) throw new Error('dust voxel read: texture is not GPU-resident');
    const fb = gl.createFramebuffer();
    // Bind through three's state cache for the same reason the upload sets
    // pixel-store state that way. README.md § Dust voxel upload.
    const { state } = renderer;
    state.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, glTex, 0, z);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    // An all-zero read is indistinguishable from a genuinely empty voxel, so
    // an incomplete framebuffer has to throw rather than report zeros.
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      state.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      throw new Error(`dust voxel read: framebuffer incomplete (0x${status.toString(16)})`);
    }
    // RGBA/UNSIGNED_BYTE is the combination WebGL2 accepts for every
    // normalised colour buffer; the R8 voxel arrives in the red byte.
    const rgba = new Uint8Array(VOXEL_RUN * 4);
    gl.readPixels(x, y, VOXEL_RUN, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    state.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    return Uint8Array.from({ length: VOXEL_RUN }, (_, i) => rgba[i * 4]);
  };
}

/** three exposes no public readback for a plain texture —
 *  `readRenderTargetPixelsAsync` only takes a RenderTarget — so the
 *  backend's own copy is the only route to a 3D texel. */
interface TexelReadbackBackend {
  copyTextureToBuffer(
    texture: THREE.Texture,
    x: number,
    y: number,
    width: number,
    height: number,
    faceIndex: number,
  ): Promise<ArrayBufferView>;
}

function webGpuVoxelReader(
  renderer: WebGPURenderer,
  texture: THREE.Data3DTexture,
): VoxelReader {
  const backend = renderer.backend as unknown as TexelReadbackBackend;
  return async (x, y, z) => {
    const out = await backend.copyTextureToBuffer(texture, x, y, VOXEL_RUN, 1, z);
    return new Uint8Array(out.buffer, out.byteOffset, VOXEL_RUN);
  };
}

export interface VoxelMismatch {
  /** Absolute grid voxel. */
  voxel: [number, number, number];
  expected: number;
  actual: number;
}

export interface ChunkVerifyReport {
  file: string;
  chunkIndices: [number, number, number];
  /** Voxels compared against the chunk file. */
  sampled: number;
  mismatches: VoxelMismatch[];
  /** Sampled voxels the chunk file says are non-zero. Zero here means the
   *  samples prove nothing — the region carries no dust to find. */
  nonZeroExpected: number;
  /** Set when the chunk could not be compared at all. */
  error?: string;
}

/** Structural view of `DustField` — the verifier needs no more than this. */
export interface VerifiableDustField {
  readonly texture: THREE.Data3DTexture;
  readonly manifest: DustManifest;
  readonly baseUrl: string;
}

/** Chunk-local byte order: z-major, x innermost, per the Python writer. */
function chunkByteIndex(size: number, lx: number, ly: number, lz: number): number {
  return (lz * size + ly) * size + lx;
}

/** The run the chunk carries the most dust in, so a chunk that landed
 *  anywhere at all produces non-zero evidence rather than 0 === 0. */
function densestRun(data: Uint8Array, size: number): [number, number, number] {
  let best: [number, number, number] = [0, 0, 0];
  let bestSum = -1;
  for (let lz = 0; lz < size; lz++) {
    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx + VOXEL_RUN <= size; lx += VOXEL_RUN) {
        const at = chunkByteIndex(size, lx, ly, lz);
        let sum = 0;
        for (let i = 0; i < VOXEL_RUN; i++) sum += data[at + i];
        if (sum > bestSum) {
          bestSum = sum;
          best = [lx, ly, lz];
        }
      }
    }
  }
  return best;
}

/** Corners plus the densest run: a wrong grid offset or a transposed axis
 *  shows up at the corners, and the densest run is the sample that carries
 *  signal. */
function sampleRuns(data: Uint8Array, size: number): Array<[number, number, number]> {
  const far = size - VOXEL_RUN;
  const edge = size - 1;
  const corners: Array<[number, number, number]> = [];
  for (const lz of [0, edge]) {
    for (const ly of [0, edge]) {
      for (const lx of [0, far]) corners.push([lx, ly, lz]);
    }
  }
  return [...corners, densestRun(data, size)];
}

async function verifyChunk(
  reader: VoxelReader,
  dust: VerifiableDustField,
  chunk: DustChunkMeta,
): Promise<ChunkVerifyReport> {
  const size = dust.manifest.chunkSize;
  const report: ChunkVerifyReport = {
    file: chunk.file,
    chunkIndices: [chunk.ix, chunk.iy, chunk.iz],
    sampled: 0,
    mismatches: [],
    nonZeroExpected: 0,
  };
  let data: Uint8Array;
  try {
    const res = await fetch(`${dust.baseUrl}${chunk.file}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== chunk.bytes) {
      throw new Error(`size mismatch: ${buf.byteLength} vs ${chunk.bytes}`);
    }
    data = new Uint8Array(buf);
  } catch (err) {
    report.error = `source unavailable: ${String(err)}`;
    return report;
  }
  for (const [lx, ly, lz] of sampleRuns(data, size)) {
    let actual: Uint8Array;
    try {
      actual = await reader(chunk.ix * size + lx, chunk.iy * size + ly, chunk.iz * size + lz);
    } catch (err) {
      report.error = String(err);
      return report;
    }
    for (let i = 0; i < VOXEL_RUN; i++) {
      const expected = data[chunkByteIndex(size, lx + i, ly, lz)];
      report.sampled++;
      if (expected !== 0) report.nonZeroExpected++;
      if (expected !== actual[i]) {
        report.mismatches.push({
          voxel: [
            chunk.ix * size + lx + i,
            chunk.iy * size + ly,
            chunk.iz * size + lz,
          ],
          expected,
          actual: actual[i],
        });
      }
    }
  }
  return report;
}

/** Compare the GPU's copy of the closest `count` chunks against the chunk
 *  files themselves. Console entry point: `stellata.verifyDust()`. */
export async function verifyDustChunks(opts: {
  renderer: StellataRenderer;
  dust: VerifiableDustField;
  count?: number;
}): Promise<ChunkVerifyReport[]> {
  const { renderer, dust, count = 3 } = opts;
  const reader = createVoxelReader(renderer, dust.texture);
  const targets = closestChunksFirst(dust.manifest.chunks).slice(0, count);
  const reports: ChunkVerifyReport[] = [];
  for (const chunk of targets) reports.push(await verifyChunk(reader, dust, chunk));
  return reports;
}

export function formatVerifyReports(reports: ChunkVerifyReport[]): string[] {
  const lines = reports.map((r) => {
    if (r.error !== undefined) return `  ${r.file}: SKIPPED — ${r.error}`;
    const m = r.mismatches[0];
    const verdict = r.mismatches.length === 0
      ? r.nonZeroExpected === 0
        ? 'match, but every sampled voxel is empty here'
        : 'MATCH'
      : `${r.mismatches.length} MISMATCH — first at voxel ${m.voxel.join(',')}`
        + ` expected ${m.expected}, GPU holds ${m.actual}`;
    return `  ${r.file}: ${r.sampled} voxels, ${r.nonZeroExpected} non-empty — ${verdict}`;
  });
  const compared = reports.filter((r) => r.error === undefined);
  const bad = compared.filter((r) => r.mismatches.length > 0).length;
  const proven = compared.filter((r) => r.nonZeroExpected > 0 && r.mismatches.length === 0).length;
  const headline = compared.length === 0
    ? 'dust voxel readback: nothing could be compared'
    : bad > 0
      ? `dust voxel readback: FAIL — ${bad}/${compared.length} chunks disagree with their source`
      : `dust voxel readback: PASS — ${compared.length} chunks match`
        + `, ${proven} carrying non-empty voxels`;
  return [headline, ...lines];
}
