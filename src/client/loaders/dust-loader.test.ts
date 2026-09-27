import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DustField, dustManifestError, loadDustManifest, type DustChunkMeta, type DustManifest,
} from './dust-loader';
import { webGpuRendererMock } from './dust-renderer-mock';

const GRID = 8;
const CHUNK = 4;
const CHUNK_BYTES = CHUNK ** 3;

const chunk = (
  ix: number, iy: number, iz: number, centerPc: [number, number, number],
): DustChunkMeta => ({
  ix, iy, iz, centerPc,
  file: `chunk_${ix}_${iy}_${iz}.bin`,
  bytes: CHUNK_BYTES,
  sha256: '',
});

function manifest(chunks: DustChunkMeta[]): DustManifest {
  return {
    version: 1,
    format: 'u8',
    synthetic: false,
    gridSize: GRID,
    chunkSize: CHUNK,
    chunksPerAxis: GRID / CHUNK,
    totalChunks: chunks.length,
    boundsPc: [-1250, 1250],
    voxelSizePc: 1,
    densityMin: 1e-7,
    densityMax: 1e-3,
    avPerDensityPerPc: 2.742,
    chunks,
  };
}

function stubFetch(byteLengthOf: (file: string) => number) {
  vi.stubGlobal('fetch', async (url: string) => {
    const file = url.split('/').pop()!;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(byteLengthOf(file)) };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDustManifest', () => {
  const serve = (body: unknown) => vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => body }));

  it('returns a well-formed manifest', async () => {
    const m = manifest([chunk(0, 0, 0, [0, 0, 0])]);
    serve(m);
    expect(await loadDustManifest('/dust/')).toEqual(m);
  });

  it('warns and returns null on a manifest a DustField cannot be built from', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases: [unknown, string][] = [
      [[], 'no positive gridSize'],
      [{ ...manifest([]), chunkSize: 3 }, 'does not divide gridSize'],
      [{ ...manifest([]), boundsPc: [1250] }, 'boundsPc'],
      [{ ...manifest([]), densityMin: 0 }, '0 < densityMin < densityMax'],
      [{ ...manifest([]), chunks: [{ ix: 0 }] }, 'malformed chunk at index 0'],
    ];
    for (const [body, reason] of cases) {
      serve(body);
      expect(await loadDustManifest('/dust/')).toBe(null);
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining(reason));
    }
    warn.mockRestore();
  });

  it('returns null without a warning when the body is not JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => { throw new SyntaxError('html'); } }));
    expect(await loadDustManifest('/dust/')).toBe(null);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('dustManifestError', () => {
  it('accepts the fixture every DustField suite here builds from', () => {
    expect(dustManifestError(manifest([chunk(0, 0, 0, [0, 0, 0])]))).toBe(null);
  });
});

describe('DustField streams chunks into the volume texture', () => {
  it('uploads closest-to-origin first, each at its own chunk indices', async () => {
    stubFetch(() => CHUNK_BYTES);
    const gpu = webGpuRendererMock();
    const far = chunk(1, 1, 1, [900, 0, 0]);
    const near = chunk(0, 0, 1, [10, 0, 0]);
    const mid = chunk(1, 0, 0, [100, 0, 0]);
    const field = new DustField(gpu.renderer, '/dust/', manifest([far, near, mid]));

    await field.startLoading();

    expect(gpu.copies.map((c) => c.dstPosition.toArray())).toEqual([
      [0, 0, CHUNK],
      [CHUNK, 0, 0],
      [CHUNK, CHUNK, CHUNK],
    ]);
  });

  it('reports progress per landed chunk and skips a truncated one', async () => {
    const bad = chunk(1, 1, 1, [900, 0, 0]);
    const good = chunk(0, 0, 0, [10, 0, 0]);
    stubFetch((file) => (file === bad.file ? CHUNK_BYTES - 1 : CHUNK_BYTES));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gpu = webGpuRendererMock();
    const field = new DustField(gpu.renderer, '/dust/', manifest([bad, good]));
    const progress: number[] = [];
    field.onProgress((p) => progress.push(p.loaded));

    await field.startLoading();

    expect(gpu.copies).toHaveLength(1);
    expect(progress).toEqual([1]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('releases the volume and the staging texture on dispose', async () => {
    stubFetch(() => CHUNK_BYTES);
    const gpu = webGpuRendererMock();
    const field = new DustField(gpu.renderer, '/dust/', manifest([chunk(0, 0, 0, [0, 0, 0])]));
    await field.startLoading();
    const disposed: string[] = [];
    field.texture.addEventListener('dispose', () => disposed.push('volume'));
    gpu.copies[0].src.addEventListener('dispose', () => disposed.push('staging'));

    field.dispose();

    expect(disposed.sort()).toEqual(['staging', 'volume']);
  });
});
