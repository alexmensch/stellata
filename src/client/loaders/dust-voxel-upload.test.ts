import { describe, expect, it } from 'vitest';
import { createVoxelChunkUploader, createVoxelTexture } from './dust-voxel-upload';
import { webGpuRendererMock } from './dust-renderer-mock';

const CHUNK = 4;
const GRID = 8;

const volumeTexture = () => createVoxelTexture(GRID, new Uint8Array(GRID ** 3));

const chunkBytes = (fill = 0) => new Uint8Array(CHUNK ** 3).fill(fill);

describe('the voxel chunk uploader', () => {
  // An unmarked texture is one three's WebGPU backend pins to a shared 1×1
  // placeholder and then refuses to grow: the first chunk's own update
  // throws 'Texture already initialized', the loader's per-chunk catch eats
  // it, and the sky is dust-free with nothing but chunk warnings to show.
  it('marks the volume for update before making it GPU-resident', () => {
    const tex = volumeTexture();
    expect(tex.version).toBe(0);
    const gpu = webGpuRendererMock();
    createVoxelChunkUploader(gpu.renderer, tex, CHUNK);

    expect(gpu.initTextures).toEqual([tex]);
    expect(gpu.initVersions[0]).toBeGreaterThan(0);
  });

  // Chunk fetches outlive a dispose, and on WebGPU a write to a released
  // texture walks three's create-on-demand path and resurrects the whole
  // ~128 MiB volume.
  it('drops uploads that arrive after dispose', () => {
    const gpu = webGpuRendererMock();
    const gpuUploader = createVoxelChunkUploader(gpu.renderer, volumeTexture(), CHUNK);
    gpuUploader.dispose();
    gpuUploader.upload(0, 0, 0, chunkBytes());
    expect(gpu.copies).toEqual([]);
  });
});

describe('the region-copy write', () => {
  it('stages the chunk in a format the copy accepts', () => {
    const tex = volumeTexture();
    const gpu = webGpuRendererMock();
    createVoxelChunkUploader(gpu.renderer, tex, CHUNK).upload(0, 0, 0, chunkBytes());

    const [copy] = gpu.copies;
    expect(copy.dst).toBe(tex);
    // WebGPU rejects a copy between differing formats outright.
    expect(copy.src.format).toBe(tex.format);
    expect(copy.src.type).toBe(tex.type);
    expect([copy.src.image.width, copy.src.image.height, copy.src.image.depth])
      .toEqual([CHUNK, CHUNK, CHUNK]);
  });

  it('copies the whole staging volume into the chunk grid offset', () => {
    const gpu = webGpuRendererMock();
    createVoxelChunkUploader(gpu.renderer, volumeTexture(), CHUNK).upload(1, 0, 2, chunkBytes());

    const [copy] = gpu.copies;
    expect(copy.region.min.toArray()).toEqual([0, 0, 0]);
    expect(copy.region.max.toArray()).toEqual([CHUNK, CHUNK, CHUNK]);
    expect(copy.dstPosition.toArray()).toEqual([CHUNK, 0, 2 * CHUNK]);
  });

  it('re-marks the reused staging texture per chunk so three re-uploads it', () => {
    const gpu = webGpuRendererMock();
    const uploader = createVoxelChunkUploader(gpu.renderer, volumeTexture(), CHUNK);
    const first = chunkBytes(1);
    const second = chunkBytes(2);
    uploader.upload(0, 0, 0, first);
    uploader.upload(1, 1, 1, second);

    const [a, b] = gpu.copies;
    expect(b.src).toBe(a.src);
    expect(a.srcData).toBe(first);
    expect(b.srcData).toBe(second);
    // A version that did not move means three's texture cache short-circuits
    // the upload and the copy re-lands the previous chunk's bytes.
    expect(b.srcVersion).toBeGreaterThan(a.srcVersion);
  });

  it('releases the staging texture on dispose', () => {
    const gpu = webGpuRendererMock();
    const uploader = createVoxelChunkUploader(gpu.renderer, volumeTexture(), CHUNK);
    uploader.upload(0, 0, 0, chunkBytes());
    let disposed = false;
    gpu.copies[0].src.addEventListener('dispose', () => { disposed = true; });

    uploader.dispose();
    expect(disposed).toBe(true);
  });
});
