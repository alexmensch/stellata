import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DustChunkMeta, DustManifest } from './dust-loader';
import { createVoxelTexture } from './dust-voxel-upload';
import {
  createVoxelReader,
  formatVerifyReports,
  verifyDustChunks,
  VOXEL_RUN,
  type VerifiableDustField,
} from './dust-voxel-readback';
import { GL_ENUM, glRendererMock, webGpuRendererMock, type VoxelSource } from './dust-renderer-mock';

const CHUNK = 4;
const GRID = 8;
const PER_AXIS = GRID / CHUNK;

/** Distinct per chunk, so a chunk landing at the wrong grid offset reads as
 *  another chunk's bytes rather than as plausible noise. */
const chunkBase = (ix: number, iy: number, iz: number) =>
  1 + (iz * PER_AXIS + iy) * PER_AXIS + ix;

const voxelValue = (
  ix: number, iy: number, iz: number, lx: number, ly: number, lz: number,
) => (chunkBase(ix, iy, iz) * 17 + (lz * CHUNK + ly) * CHUNK + lx) % 256;

/** What the GPU holds when every chunk landed exactly where it should. */
const correctGrid: VoxelSource = (x, y, z) => voxelValue(
  Math.floor(x / CHUNK), Math.floor(y / CHUNK), Math.floor(z / CHUNK),
  x % CHUNK, y % CHUNK, z % CHUNK,
);

function chunkFile(ix: number, iy: number, iz: number): Uint8Array {
  const out = new Uint8Array(CHUNK ** 3);
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        out[(lz * CHUNK + ly) * CHUNK + lx] = voxelValue(ix, iy, iz, lx, ly, lz);
      }
    }
  }
  return out;
}

const chunk = (
  ix: number, iy: number, iz: number, centerPc: [number, number, number],
): DustChunkMeta => ({
  ix, iy, iz, centerPc,
  file: `chunk_${ix}_${iy}_${iz}.bin`,
  bytes: CHUNK ** 3,
  sha256: '',
});

function dustField(chunks: DustChunkMeta[]): VerifiableDustField {
  const manifest: DustManifest = {
    version: 1,
    format: 'u8',
    synthetic: false,
    gridSize: GRID,
    chunkSize: CHUNK,
    chunksPerAxis: PER_AXIS,
    totalChunks: chunks.length,
    boundsPc: [-1250, 1250],
    voxelSizePc: 1,
    densityMin: 1e-7,
    densityMax: 1e-3,
    avPerDensityPerPc: 2.742,
    chunks,
  };
  return { texture: createVoxelTexture(GRID, null), manifest, baseUrl: '/dust/' };
}

function stubChunkFetch({ fail = '' } = {}) {
  vi.stubGlobal('fetch', async (url: string) => {
    const file = url.split('/').pop()!;
    if (file === fail) return { ok: false, status: 404, statusText: 'Not Found' };
    const [, ix, iy, iz] = /chunk_(\d+)_(\d+)_(\d+)/.exec(file)!;
    return {
      ok: true,
      arrayBuffer: async () => chunkFile(Number(ix), Number(iy), Number(iz)).buffer,
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading voxels back off the GPU', () => {
  it('returns the same run on either backend', async () => {
    const tex = createVoxelTexture(GRID, null);
    const gl = glRendererMock({ voxels: correctGrid });
    const gpu = webGpuRendererMock({ voxels: correctGrid });

    const fromGl = await createVoxelReader(gl.renderer, tex)(CHUNK, 1, 5);
    const fromGpu = await createVoxelReader(gpu.renderer, tex)(CHUNK, 1, 5);

    const expected = Uint8Array.from(
      { length: VOXEL_RUN }, (_, i) => correctGrid(CHUNK + i, 1, 5),
    );
    expect([...fromGl]).toEqual([...expected]);
    expect([...fromGpu]).toEqual([...expected]);
    expect(gpu.reads).toEqual([[CHUNK, 1, 5]]);
  });

  // Same rule as the upload's pixel-store resets: a raw bind desyncs three's
  // state cache from GL, and the next pass renders into the wrong target.
  it('binds the readback framebuffer through three, never on the context', async () => {
    const gl = glRendererMock({ voxels: correctGrid });
    await createVoxelReader(gl.renderer, createVoxelTexture(GRID, null))(0, 0, 3);

    expect(gl.contextFramebuffers).toEqual([]);
    expect(gl.stateFramebuffers.map((c) => c[0])).toEqual([
      GL_ENUM.FRAMEBUFFER, GL_ENUM.FRAMEBUFFER,
    ]);
    expect(gl.stateFramebuffers[1][1]).toBe(null);
    expect(gl.readLayers).toEqual([3]);
    expect(gl.liveFramebuffers).toBe(0);
  });

  // An all-zero read is indistinguishable from empty space, so a readback
  // that cannot work has to say so rather than report zeros.
  it('throws rather than reporting zeros when the read cannot work', async () => {
    const incomplete = glRendererMock({ framebufferComplete: false });
    await expect(
      createVoxelReader(incomplete.renderer, createVoxelTexture(GRID, null))(0, 0, 0),
    ).rejects.toThrow(/framebuffer incomplete/);
    expect(incomplete.liveFramebuffers).toBe(0);

    const absent = glRendererMock({ resident: false });
    await expect(
      createVoxelReader(absent.renderer, createVoxelTexture(GRID, null))(0, 0, 0),
    ).rejects.toThrow(/not GPU-resident/);
  });
});

describe('verifying a landed chunk against its source file', () => {
  it('passes when the GPU holds what the chunk file says, with signal', async () => {
    stubChunkFetch();
    const gpu = webGpuRendererMock({ voxels: correctGrid });
    const dust = dustField([chunk(1, 1, 1, [900, 0, 0]), chunk(0, 0, 1, [10, 0, 0])]);

    const reports = await verifyDustChunks({ renderer: gpu.renderer, dust, count: 1 });

    expect(reports).toHaveLength(1);
    // Closest-to-origin first: the same order the loader streamed them in.
    expect(reports[0].file).toBe('chunk_0_0_1.bin');
    expect(reports[0].mismatches).toEqual([]);
    expect(reports[0].sampled).toBe(9 * VOXEL_RUN);
    expect(reports[0].nonZeroExpected).toBeGreaterThan(0);
    expect(formatVerifyReports(reports)[0]).toContain('PASS');
  });

  it('reports the voxel, the expected byte and what the GPU actually holds', async () => {
    stubChunkFetch();
    // A chunk that never landed: the volume is still zero-filled there.
    const gpu = webGpuRendererMock({ voxels: () => 0 });
    const dust = dustField([chunk(1, 0, 0, [10, 0, 0])]);

    const reports = await verifyDustChunks({ renderer: gpu.renderer, dust });

    const [report] = reports;
    expect(report.mismatches.length).toBeGreaterThan(0);
    const [first] = report.mismatches;
    expect(first.actual).toBe(0);
    expect(first.expected).toBeGreaterThan(0);
    // Absolute grid coordinates, so the voxel names a place in the volume.
    expect(first.voxel[0]).toBeGreaterThanOrEqual(CHUNK);
    expect(formatVerifyReports(reports)[0]).toContain('FAIL');
  });

  // Empty space reads as zero on a working upload and on a broken one alike,
  // so the densest run in the file is always one of the samples.
  it('samples the run the chunk carries the most dust in', async () => {
    stubChunkFetch();
    const gpu = webGpuRendererMock({ voxels: correctGrid });
    const dust = dustField([chunk(0, 0, 0, [1, 0, 0])]);

    await verifyDustChunks({ renderer: gpu.renderer, dust });

    const file = chunkFile(0, 0, 0);
    let bestSum = -1;
    let bestRun: [number, number, number] = [0, 0, 0];
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx + VOXEL_RUN <= CHUNK; lx += VOXEL_RUN) {
          let sum = 0;
          for (let i = 0; i < VOXEL_RUN; i++) sum += file[(lz * CHUNK + ly) * CHUNK + lx + i];
          if (sum > bestSum) {
            bestSum = sum;
            bestRun = [lx, ly, lz];
          }
        }
      }
    }
    expect(gpu.reads).toContainEqual(bestRun);
  });

  it('skips a chunk whose source it cannot fetch instead of claiming a pass', async () => {
    stubChunkFetch({ fail: 'chunk_0_0_0.bin' });
    const gpu = webGpuRendererMock({ voxels: correctGrid });
    const dust = dustField([chunk(0, 0, 0, [1, 0, 0])]);

    const reports = await verifyDustChunks({ renderer: gpu.renderer, dust });

    expect(reports[0].error).toContain('404');
    expect(reports[0].sampled).toBe(0);
    expect(gpu.reads).toEqual([]);
    expect(formatVerifyReports(reports)[0]).toContain('nothing could be compared');
  });
});
