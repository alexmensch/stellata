// Per-backend half of the dust voxel streaming upload: land one chunk in
// the volume texture without re-uploading the whole grid. See README.md
// § Dust voxel upload.

import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { StellataRenderer } from '../webgpu/seam';

/** Reads three's own flag through the `WebGPURenderer` type rather than an
 *  `in` test, so a mistyped property name fails to compile. */
export function isWebGpuRenderer(r: StellataRenderer): r is WebGPURenderer {
  return (r as WebGPURenderer).isWebGPURenderer === true;
}

export function glTextureOf(
  renderer: THREE.WebGLRenderer,
  texture: THREE.Texture,
): WebGLTexture | undefined {
  return (renderer.properties.get(texture) as {
    __webglTexture?: WebGLTexture;
  }).__webglTexture;
}

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
  return isWebGpuRenderer(renderer)
    ? new WebGpuVoxelChunkUploader(renderer, texture, chunkSize)
    : new GlVoxelChunkUploader(renderer, texture, chunkSize);
}

abstract class ChunkUploader implements VoxelChunkUploader {
  private disposed = false;

  constructor(protected readonly chunkSize: number) {}

  upload(ix: number, iy: number, iz: number, data: Uint8Array) {
    if (this.disposed) return;
    const c = this.chunkSize;
    this.write(ix * c, iy * c, iz * c, data);
  }

  dispose() {
    this.disposed = true;
    this.release();
  }

  /** Land `data` with its near corner at the given voxel offset. */
  protected abstract write(x: number, y: number, z: number, data: Uint8Array): void;

  protected release() {}
}

class GlVoxelChunkUploader extends ChunkUploader {
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly texture: THREE.Data3DTexture,
    chunkSize: number,
  ) {
    super(chunkSize);
  }

  protected write(x: number, y: number, z: number, data: Uint8Array) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const glTex = glTextureOf(this.renderer, this.texture);
    if (!glTex) {
      // Reachable when initTexture has not flushed, so the branch is live
      // even though the progress listeners then fall one chunk short.
      console.warn('dust texture not yet GPU-resident, dropping chunk');
      return;
    }
    gl.bindTexture(gl.TEXTURE_3D, glTex);
    // Through three's state cache, never the raw context — a poke leaves the
    // cache claiming a flip that is no longer set. README.md § Dust voxel
    // upload.
    const { state } = this.renderer;
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const c = this.chunkSize;
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      x, y, z,
      c, c, c,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data,
    );
  }
}

class WebGpuVoxelChunkUploader extends ChunkUploader {
  // three's WebGPU backend exposes no sub-region texture write, so a chunk
  // reaches the volume as a whole upload of this chunk-sized scratch
  // texture plus a region copy. README.md § Dust voxel upload.
  private readonly staging: THREE.Data3DTexture;
  private readonly srcRegion: THREE.Box3;
  private readonly dstPosition = new THREE.Vector3();

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly texture: THREE.Data3DTexture,
    chunkSize: number,
  ) {
    super(chunkSize);
    this.staging = createVoxelTexture(chunkSize, null);
    this.srcRegion = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(chunkSize, chunkSize, chunkSize),
    );
  }

  protected write(x: number, y: number, z: number, data: Uint8Array) {
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

  protected release() {
    this.staging.dispose();
  }
}
