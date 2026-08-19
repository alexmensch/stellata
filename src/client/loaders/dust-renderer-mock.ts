// Renderer stand-ins for the dust voxel upload: enough of each backend's
// surface for createVoxelChunkUploader to drive headless, recording what
// it asked the GPU to do.

import type * as THREE from 'three';
import type { StellataRenderer } from '../webgpu/seam';

export const GL_ENUM = {
  TEXTURE_3D: 0x806f,
  RED: 0x1903,
  UNSIGNED_BYTE: 0x1401,
  UNPACK_ALIGNMENT: 0x0cf5,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
};

export interface GlRendererMock {
  renderer: StellataRenderer;
  initTextures: THREE.Texture[];
  boundTargets: number[];
  subImages: unknown[][];
  contextPixelStorei: unknown[][];
  statePixelStorei: unknown[][];
}

/** `resident: false` withholds the GPU texture handle, standing in for an
 *  initTexture that hasn't flushed. */
export function glRendererMock({ resident = true } = {}): GlRendererMock {
  const m: Omit<GlRendererMock, 'renderer'> = {
    initTextures: [],
    boundTargets: [],
    subImages: [],
    contextPixelStorei: [],
    statePixelStorei: [],
  };
  const gl = {
    ...GL_ENUM,
    bindTexture: (target: number) => m.boundTargets.push(target),
    texSubImage3D: (...args: unknown[]) => m.subImages.push(args),
    pixelStorei: (...args: unknown[]) => m.contextPixelStorei.push(args),
  };
  const renderer = {
    getContext: () => gl,
    properties: { get: () => (resident ? { __webglTexture: {} } : {}) },
    state: { pixelStorei: (...args: unknown[]) => m.statePixelStorei.push(args) },
    initTexture: (t: THREE.Texture) => m.initTextures.push(t),
  };
  return { ...m, renderer: renderer as unknown as StellataRenderer };
}

export interface VoxelCopy {
  src: THREE.Data3DTexture;
  dst: THREE.Texture;
  region: THREE.Box3;
  dstPosition: THREE.Vector3;
  /** Snapshotted at call time — the uploader reuses the staging texture,
   *  the region and the destination vector across chunks. */
  srcVersion: number;
  srcData: THREE.Data3DTexture['image']['data'];
}

export interface WebGpuRendererMock {
  renderer: StellataRenderer;
  initTextures: THREE.Texture[];
  copies: VoxelCopy[];
}

export function webGpuRendererMock(): WebGpuRendererMock {
  const initTextures: THREE.Texture[] = [];
  const copies: VoxelCopy[] = [];
  const renderer = {
    isWebGPURenderer: true,
    initTexture: (t: THREE.Texture) => initTextures.push(t),
    copyTextureToTexture: (
      src: THREE.Data3DTexture,
      dst: THREE.Texture,
      region: THREE.Box3,
      dstPosition: THREE.Vector3,
    ) => {
      copies.push({
        src,
        dst,
        region: region.clone(),
        dstPosition: dstPosition.clone(),
        srcVersion: src.version,
        srcData: src.image.data,
      });
    },
  };
  return { renderer: renderer as unknown as StellataRenderer, initTextures, copies };
}
