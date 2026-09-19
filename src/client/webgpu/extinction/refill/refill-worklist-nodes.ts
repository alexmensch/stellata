// The refill worklist's shared slots: the stamp and worklist buffers the
// compaction writes for the prepass, and the uniforms that arm and address
// them. README.md § The compaction appends the worklist.

import { StorageBufferAttribute } from 'three/webgpu';
import { storage, uniform } from 'three/tsl';

export type UintStorageNode = ReturnType<typeof storage<'uint'>>;

/** Bound by the compaction kernel from its first frame, so both slots sit
 *  over a placeholder until the prepass owns real buffers (../README.md
 *  § One owner for every shared slot). */
export class RefillWorklistNodes {
  /** Per star, the camera generation its A_V was marched at. */
  readonly stamps: UintStorageNode;
  readonly worklist: UintStorageNode;
  readonly arm = uniform(0, 'uint');
  /** Starts past the zero a fresh stamp buffer holds. */
  readonly cameraGeneration = uniform(1, 'uint');
  /** The sub-list the prepass marches next and the finish kernel sizes. */
  readonly quarter = uniform(0, 'uint');

  private readonly stampsPlaceholder = new StorageBufferAttribute(new Uint32Array(1), 1);
  private readonly worklistPlaceholder = new StorageBufferAttribute(new Uint32Array(1), 1);

  constructor() {
    this.stamps = storage(this.stampsPlaceholder, 'uint', 1);
    this.worklist = storage(this.worklistPlaceholder, 'uint', 1);
  }

  /** The placeholders' 8 bytes live with the renderer, which is the only
   *  thing that frees them. */
  setBuffers(stamps: StorageBufferAttribute | null, worklist: StorageBufferAttribute | null): void {
    this.stamps.value = stamps ?? this.stampsPlaceholder;
    this.worklist.value = worklist ?? this.worklistPlaceholder;
  }

  dispose(): void {
    this.setBuffers(null, null);
    this.arm.value = 0;
  }
}
