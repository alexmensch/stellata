// The extinction slots as TSL nodes — the dust volume, the per-star A_V
// buffer and the refill worklist's — shared by object identity between the
// star layer and the prepass so one attach reaches both. README.md#one-owner-for-every-shared-slot.

import { StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import type { Data3DTexture } from 'three';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { dustTextureNode, type DustTextureNode } from './dust-raymarch-tsl';
import { RefillWorklistNodes } from './refill/refill-worklist-nodes';

export type AvStorageNode = ReturnType<typeof storage<'float'>>;

/**
 * Every slot binds over a placeholder whose `.value` is swapped when the
 * real resource arrives — a node cannot carry a nullable texture or
 * buffer. All are BOUND every frame whatever their enable scalar says,
 * so each placeholder must be valid from the first frame: the volume's
 * marks itself `needsUpdate`, or three substitutes a 2D 1×1 texture on
 * the `texture_3d` binding and the whole submit dies with the bind group
 * (README.md#one-owner-for-every-shared-slot).
 */
export class ExtinctionNodes {
  readonly dust: DustTextureNode;
  readonly av: AvStorageNode;
  /** refill/README.md#the-compaction-appends-the-worklist. */
  readonly refill = new RefillWorklistNodes();

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
    this.refill.dispose();
    this.dustPlaceholder.dispose();
  }
}
