// Renderer stand-ins for the dust voxel upload and readback: enough of
// each backend's surface to drive both headless, recording what they asked
// the GPU to do.

import type * as THREE from 'three';
import type { StellataRenderer } from '../webgpu/seam';

export const GL_ENUM = {
  TEXTURE_3D: 0x806f,
  RED: 0x1903,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  UNPACK_ALIGNMENT: 0x0cf5,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  FRAMEBUFFER_UNSUPPORTED: 0x8cdd,
};

/** Grid contents a readback mock answers from. */
export type VoxelSource = (x: number, y: number, z: number) => number;

const EMPTY_GRID: VoxelSource = () => 0;

export interface GlRendererMock {
  renderer: StellataRenderer;
  initTextures: THREE.Texture[];
  /** `texture.version` as it stood at each initTexture call — the marked-
   *  before-init order is what keeps WebGPU off its 1×1 placeholder. */
  initVersions: number[];
  boundTargets: number[];
  subImages: unknown[][];
  contextPixelStorei: unknown[][];
  statePixelStorei: unknown[][];
  /** Raw framebuffer pokes. Must stay empty — same state-cache rule as the
   *  pixel-store resets. */
  contextFramebuffers: unknown[][];
  stateFramebuffers: unknown[][];
  readLayers: number[];
  liveFramebuffers: number;
}

/** `resident: false` withholds the GPU texture handle, standing in for an
 *  initTexture that hasn't flushed. */
export function glRendererMock({
  resident = true,
  voxels = EMPTY_GRID,
  framebufferComplete = true,
} = {} as { resident?: boolean; voxels?: VoxelSource; framebufferComplete?: boolean }): GlRendererMock {
  const m: Omit<GlRendererMock, 'renderer'> = {
    initTextures: [],
    initVersions: [],
    boundTargets: [],
    subImages: [],
    contextPixelStorei: [],
    statePixelStorei: [],
    contextFramebuffers: [],
    stateFramebuffers: [],
    readLayers: [],
    liveFramebuffers: 0,
  };
  let layer = 0;
  const gl = {
    ...GL_ENUM,
    bindTexture: (target: number) => m.boundTargets.push(target),
    texSubImage3D: (...args: unknown[]) => m.subImages.push(args),
    pixelStorei: (...args: unknown[]) => m.contextPixelStorei.push(args),
    bindFramebuffer: (...args: unknown[]) => m.contextFramebuffers.push(args),
    createFramebuffer: () => {
      m.liveFramebuffers++;
      return {};
    },
    deleteFramebuffer: () => {
      m.liveFramebuffers--;
    },
    framebufferTextureLayer: (
      _target: number, _attachment: number, _tex: unknown, _level: number, z: number,
    ) => {
      layer = z;
      m.readLayers.push(z);
    },
    checkFramebufferStatus: () =>
      framebufferComplete ? GL_ENUM.FRAMEBUFFER_COMPLETE : GL_ENUM.FRAMEBUFFER_UNSUPPORTED,
    readPixels: (
      x: number, y: number, width: number, _height: number,
      _format: number, _type: number, dst: Uint8Array,
    ) => {
      for (let i = 0; i < width; i++) dst[i * 4] = voxels(x + i, y, layer);
    },
  };
  const renderer = {
    getContext: () => gl,
    properties: { get: () => (resident ? { __webglTexture: {} } : {}) },
    state: {
      pixelStorei: (...args: unknown[]) => m.statePixelStorei.push(args),
      bindFramebuffer: (...args: unknown[]) => m.stateFramebuffers.push(args),
    },
    initTexture: (t: THREE.Texture) => {
      m.initTextures.push(t);
      m.initVersions.push(t.version);
    },
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
  initVersions: number[];
  copies: VoxelCopy[];
  reads: Array<[number, number, number]>;
}

export function webGpuRendererMock(
  { voxels = EMPTY_GRID } = {} as { voxels?: VoxelSource },
): WebGpuRendererMock {
  const initTextures: THREE.Texture[] = [];
  const initVersions: number[] = [];
  const copies: VoxelCopy[] = [];
  const reads: Array<[number, number, number]> = [];
  const renderer = {
    isWebGPURenderer: true,
    initTexture: (t: THREE.Texture) => {
      initTextures.push(t);
      initVersions.push(t.version);
    },
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
    backend: {
      copyTextureToBuffer: async (
        _texture: THREE.Texture, x: number, y: number,
        width: number, _height: number, z: number,
      ) => {
        reads.push([x, y, z]);
        return Uint8Array.from({ length: width }, (_, i) => voxels(x + i, y, z));
      },
    },
  };
  return {
    renderer: renderer as unknown as StellataRenderer,
    initTextures,
    initVersions,
    copies,
    reads,
  };
}
