// Per-backend half of the dust voxel streaming upload: land one chunk in
// the volume texture without re-uploading the whole grid. See README.md
// § Dust voxel upload.

import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { StellataRenderer } from '../webgpu/seam';

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
  // Must run before any partial upload, and after the texture is marked
  // for update — otherwise chunks land in unallocated storage or in a 1×1
  // placeholder, silently. README.md § Dust voxel upload.
  renderer.initTexture(texture);
  return 'isWebGPURenderer' in renderer
    ? new WebGpuVoxelChunkUploader(renderer, texture, chunkSize)
    : new GlVoxelChunkUploader(renderer, texture, chunkSize);
}

class GlVoxelChunkUploader implements VoxelChunkUploader {
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly texture: THREE.Data3DTexture,
    private readonly chunkSize: number,
  ) {}

  upload(ix: number, iy: number, iz: number, data: Uint8Array) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const glTex = (this.renderer.properties.get(this.texture) as {
      __webglTexture?: WebGLTexture;
    }).__webglTexture;
    if (!glTex) {
      // Can happen if initTexture hasn't flushed yet (rare); skip this
      // chunk silently and the caller's listeners will see us fall one
      // short of total. Alternative would be to defer upload a frame.
      console.warn('dust texture not yet GPU-resident, dropping chunk');
      return;
    }
    gl.bindTexture(gl.TEXTURE_3D, glTex);
    // Required (texSubImage3D fails outright under flip or premultiply) and
    // required to go through three's cache — a raw context poke desyncs it
    // and the next flipY upload anywhere in the app lands mirrored.
    // README.md § Dust voxel upload.
    const { state } = this.renderer;
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const c = this.chunkSize;
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      ix * c, iy * c, iz * c, // offsets
      c, c, c,                // size
      gl.RED,
      gl.UNSIGNED_BYTE,
      data,
    );
  }

  dispose() {}
}

class WebGpuVoxelChunkUploader implements VoxelChunkUploader {
  // three's WebGPU backend exposes no sub-region texture write, so a chunk
  // reaches the volume as a whole upload of this chunk-sized scratch
  // texture plus a region copy. README.md § Dust voxel upload.
  private readonly staging: THREE.Data3DTexture;
  private readonly srcRegion: THREE.Box3;
  private readonly dstPosition = new THREE.Vector3();

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly texture: THREE.Data3DTexture,
    private readonly chunkSize: number,
  ) {
    const c = chunkSize;
    this.staging = new THREE.Data3DTexture(null, c, c, c);
    this.staging.format = texture.format;
    this.staging.type = texture.type;
    this.srcRegion = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(c, c, c),
    );
  }

  upload(ix: number, iy: number, iz: number, data: Uint8Array) {
    const c = this.chunkSize;
    this.staging.image.data = data;
    this.staging.needsUpdate = true;
    this.renderer.copyTextureToTexture(
      this.staging,
      this.texture,
      this.srcRegion,
      this.dstPosition.set(ix * c, iy * c, iz * c),
    );
  }

  dispose() {
    this.staging.dispose();
  }
}
