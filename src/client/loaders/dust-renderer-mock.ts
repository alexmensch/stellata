// Renderer stand-in for the dust voxel upload and readback: enough of the
// renderer's surface to drive both headless, recording what they asked the
// GPU to do.

import type * as THREE from 'three';
import type { StellataRenderer } from '../webgpu/seam';

/** Grid contents a readback mock answers from. */
export type VoxelSource = (x: number, y: number, z: number) => number;

const EMPTY_GRID: VoxelSource = () => 0;

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
