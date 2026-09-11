// The two extinction slots as TSL nodes — the dust volume and the per-star
// A_V buffer — shared by object identity between the star vertex stage and
// the prepass kernel so one attach reaches both. README.md § Two nodes, one owner.

import { StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import type { Data3DTexture } from 'three';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { dustTextureNode, type DustTextureNode } from './dust-raymarch-tsl';

export type AvStorageNode = ReturnType<typeof storage<'float'>>;

/**
 * Both slots bind over a placeholder whose `.value` is swapped when the
 * real resource arrives — a node cannot carry a nullable texture or
 * buffer. Both are BOUND every frame whatever their enable scalar says,
 * so each placeholder must be valid from the first frame: the volume's
 * marks itself `needsUpdate`, or three substitutes a 2D 1×1 texture on
 * the `texture_3d` binding and the whole submit dies with the bind group
 * (README.md § Two nodes, one owner).
 */
export class ExtinctionNodes {
  readonly dust: DustTextureNode;
  readonly av: AvStorageNode;

  private readonly dustPlaceholder: Data3DTexture;
  private readonly avPlaceholder: StorageBufferAttribute;

  constructor() {
    this.dustPlaceholder = createVoxelTexture(1, new Uint8Array(1));
    this.dustPlaceholder.needsUpdate = true;
    this.avPlaceholder = new StorageBufferAttribute(1, 1);
    this.dust = dustTextureNode(this.dustPlaceholder);
    this.av = storage(this.avPlaceholder, 'float', 1);
  }

  setDustTexture(tex: Data3DTexture | null): void {
    this.dust.value = tex ?? this.dustPlaceholder;
  }

  /** Point the consumers' A_V read at the prepass's own buffer, or back at
   *  the placeholder. The placeholder's 4-byte GPU buffer lives with the
   *  renderer, which is the only thing that frees it. */
  setAvBuffer(attr: StorageBufferAttribute | null): void {
    this.av.value = attr ?? this.avPlaceholder;
  }

  dispose(): void {
    this.setDustTexture(null);
    this.setAvBuffer(null);
    this.dustPlaceholder.dispose();
  }
}
