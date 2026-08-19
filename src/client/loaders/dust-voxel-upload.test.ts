import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createVoxelChunkUploader } from './dust-voxel-upload';
import { GL_ENUM, glRendererMock, webGpuRendererMock } from './dust-renderer-mock';

const CHUNK = 4;
const GRID = 8;

function volumeTexture() {
  const tex = new THREE.Data3DTexture(new Uint8Array(GRID ** 3), GRID, GRID, GRID);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  return tex;
}

const chunkBytes = (fill = 0) => new Uint8Array(CHUNK ** 3).fill(fill);

describe('the voxel chunk uploader picks its backend', () => {
  it('makes the volume GPU-resident before the first partial upload', () => {
    const tex = volumeTexture();
    const gl = glRendererMock();
    createVoxelChunkUploader(gl.renderer, tex, CHUNK);
    expect(gl.initTextures).toEqual([tex]);

    const gpu = webGpuRendererMock();
    createVoxelChunkUploader(gpu.renderer, tex, CHUNK);
    expect(gpu.initTextures).toEqual([tex]);
  });

  it('routes a WebGPU renderer to the region-copy path', () => {
    const gpu = webGpuRendererMock();
    createVoxelChunkUploader(gpu.renderer, volumeTexture(), CHUNK)
      .upload(1, 0, 0, chunkBytes());
    expect(gpu.copies).toHaveLength(1);
  });
});

describe('the WebGL2 uploader', () => {
  it('writes the chunk at its grid offset, one chunk-sized block', () => {
    const gl = glRendererMock();
    const data = chunkBytes(7);
    createVoxelChunkUploader(gl.renderer, volumeTexture(), CHUNK).upload(1, 0, 2, data);

    expect(gl.boundTargets).toEqual([GL_ENUM.TEXTURE_3D]);
    expect(gl.subImages).toEqual([[
      GL_ENUM.TEXTURE_3D, 0,
      CHUNK, 0, 2 * CHUNK,
      CHUNK, CHUNK, CHUNK,
      GL_ENUM.RED, GL_ENUM.UNSIGNED_BYTE, data,
    ]]);
  });

  // Poking the context directly leaves three's state cache claiming a flip
  // that is no longer set, so the next flipY upload skips its own call and
  // lands mirrored — a texture the user sees flipped, from a write in a
  // different subsystem. The reset has to go through renderer.state to stay
  // truthful.
  it('clears flip, premultiply and alignment through three, never on the context', () => {
    const gl = glRendererMock();
    createVoxelChunkUploader(gl.renderer, volumeTexture(), CHUNK).upload(0, 0, 0, chunkBytes());

    expect(gl.contextPixelStorei).toEqual([]);
    expect(gl.statePixelStorei).toEqual([
      [GL_ENUM.UNPACK_ALIGNMENT, 1],
      [GL_ENUM.UNPACK_FLIP_Y_WEBGL, false],
      [GL_ENUM.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false],
    ]);
  });

  it('drops the chunk rather than uploading into an unallocated texture', () => {
    const gl = glRendererMock({ resident: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createVoxelChunkUploader(gl.renderer, volumeTexture(), CHUNK).upload(0, 0, 0, chunkBytes());

    expect(gl.subImages).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the WebGPU uploader', () => {
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
