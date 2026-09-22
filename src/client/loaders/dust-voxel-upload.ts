// The dust voxel streaming upload: land one chunk in the volume texture
// without re-uploading the whole grid. See README.md § Dust voxel upload.

import * as THREE from 'three';
import type { StellataRenderer } from '../webgpu/seam';

/** The volume and every staging texture come from here so their format and
 *  type cannot drift apart — WebGPU rejects a copy between differing
 *  formats. */
export function createVoxelTexture(
  size: number,
  data: Uint8Array | null,
): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  return tex;
}

export interface VoxelChunkUploader {
  /** Write one chunkSize³ block of the grid at the given chunk indices. */
  upload(ix: number, iy: number, iz: number, data: Uint8Array): void;
  dispose(): void;
}

export function createVoxelChunkUploader(
  renderer: StellataRenderer,
  texture: THREE.Data3DTexture,
  chunkSize: number,
): VoxelChunkUploader {
  // Marking before initTexture is the load-bearing order, which is why the
  // factory owns both halves of it. README.md § Dust voxel upload.
  texture.needsUpdate = true;
  renderer.initTexture(texture);
  return new WebGpuVoxelChunkUploader(renderer, texture, chunkSize);
}

class WebGpuVoxelChunkUploader implements VoxelChunkUploader {
  // three's WebGPU backend exposes no sub-region texture write, so a chunk
  // reaches the volume as a whole upload of this chunk-sized scratch
  // texture plus a region copy. README.md § Dust voxel upload.
  private readonly staging: THREE.Data3DTexture;
  private readonly srcRegion: THREE.Box3;
  private readonly dstPosition = new THREE.Vector3();
  private disposed = false;

  constructor(
    private readonly renderer: StellataRenderer,
    private readonly texture: THREE.Data3DTexture,
    private readonly chunkSize: number,
  ) {
    this.staging = createVoxelTexture(chunkSize, null);
    this.srcRegion = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(chunkSize, chunkSize, chunkSize),
    );
  }

  upload(ix: number, iy: number, iz: number, data: Uint8Array) {
    if (this.disposed) return;
    const c = this.chunkSize;
    this.write(ix * c, iy * c, iz * c, data);
  }

  dispose() {
    this.disposed = true;
    this.staging.dispose();
  }

  private write(x: number, y: number, z: number, data: Uint8Array) {
    this.staging.image.data = data;
    // three's texture cache short-circuits on an unchanged version, and the
    // copy would then re-land the previous chunk's bytes at the new offset.
    this.staging.needsUpdate = true;
    this.renderer.copyTextureToTexture(
      this.staging,
      this.texture,
      this.srcRegion,
      this.dstPosition.set(x, y, z),
    );
  }
}
