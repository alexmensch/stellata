// The two extinction texture slots as TSL nodes, shared by object
// identity between the star vertex stage and the prepass march so one
// attach reaches both. README.md § Two nodes, one owner.

import { DataTexture, FloatType, NearestFilter, RedFormat } from 'three';
import { texture } from 'three/tsl';
import type { Data3DTexture, Texture } from 'three';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import { dustTextureNode, type DustTextureNode } from './dust-raymarch-tsl';

export type AvPrepassTextureNode = ReturnType<typeof texture>;

/**
 * A uniform node cannot carry a nullable texture, so both slots bind over
 * a 1-texel placeholder whose `.value` is swapped when the real texture
 * arrives (`../tsl/README.md` § Shared uniform nodes). The placeholders match
 * their targets' format and type exactly: a swap to a differently-typed
 * texture would rebuild the pipeline, and the volume's staging copies
 * already share `createVoxelTexture` for that reason.
 *
 * Neither slot is read while its `uDustEnabled` / `uAvPrepassEnabled`
 * scalar is 0, so the placeholder's contents never reach a pixel. They are
 * still BOUND every frame regardless — the gate is a runtime branch and
 * both arms compile — so each must be a valid texture of its slot's
 * dimensionality from the very first frame.
 *
 * **Every placeholder marks itself `needsUpdate` at construction.** Three's
 * WebGPU backend substitutes a shared 1×1 **2D** texture for any texture it
 * has not seen marked, then refuses to grow it because the version never
 * moved (`../../loaders/README.md` § Dust voxel upload). On the volume slot
 * that lands a 2D view on a `texture_3d` binding, which invalidates the
 * bind group — and an invalid bind group takes the whole submit with it.
 * `createVoxelTexture` deliberately does NOT mark: the volume's mark is the
 * uploader's, paired with `initTexture` in an order that matters, so a
 * placeholder built from that factory has to mark itself.
 */
export class ExtinctionTextureNodes {
  readonly dust: DustTextureNode;
  readonly avPrepass: AvPrepassTextureNode;

  private readonly dustPlaceholder: Data3DTexture;
  private readonly avPlaceholder: DataTexture;

  constructor() {
    this.dustPlaceholder = createVoxelTexture(1, new Uint8Array(1));
    this.dustPlaceholder.needsUpdate = true;
    this.avPlaceholder = new DataTexture(
      new Float32Array(1), 1, 1, RedFormat, FloatType);
    this.avPlaceholder.minFilter = NearestFilter;
    this.avPlaceholder.magFilter = NearestFilter;
    this.avPlaceholder.needsUpdate = true;
    this.dust = dustTextureNode(this.dustPlaceholder);
    this.avPrepass = texture(this.avPlaceholder);
  }

  setDustTexture(tex: Data3DTexture | null): void {
    this.dust.value = tex ?? this.dustPlaceholder;
  }

  setAvPrepassTexture(tex: Texture | null): void {
    this.avPrepass.value = tex ?? this.avPlaceholder;
  }

  dispose(): void {
    this.setDustTexture(null);
    this.setAvPrepassTexture(null);
    this.dustPlaceholder.dispose();
    this.avPlaceholder.dispose();
  }
}
