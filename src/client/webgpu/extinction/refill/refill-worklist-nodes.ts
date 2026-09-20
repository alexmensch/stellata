// The refill's shared slots: the stamps, the fused slot/worklist table and
// the uniforms that arm and address them.
// README.md § The compaction appends the worklist.

import { StorageBufferAttribute, type Node } from 'three/webgpu';
import { storage, uint, uniform } from 'three/tsl';
import { REFILL_LIST_COUNT_BASE } from '../../star/compaction/compaction-pure';
import { refillBucketCapacity } from './refill-buckets-pure';

export type UintStorageNode = ReturnType<typeof storage<'uint'>>;

/** Bound by the compaction kernel from its first frame, so both slots sit
 *  over a placeholder until the prepass owns real buffers (../README.md
 *  § One owner for every shared slot). */
export class RefillWorklistNodes {
  /** Per star, the camera generation its A_V was marched at. */
  readonly stamps: UintStorageNode;
  /** Star → slot over `[0, count)`, then the worklist
   *  (../../star/compaction/README.md § Binding budget). Address it through
   *  `slotOf`, `bucketOf` and `worklistElement`, never by raw index. */
  readonly table: UintStorageNode;
  readonly arm = uniform(0, 'uint');
  /** Starts past the zero a fresh stamp buffer holds. */
  readonly cameraGeneration = uniform(1, 'uint');
  /** The residue class the prepass marches next and the compaction builds. */
  readonly quarter = uniform(0, 'uint');

  private readonly stampsPlaceholder = new StorageBufferAttribute(new Uint32Array(1), 1);
  private readonly tablePlaceholder = new StorageBufferAttribute(new Uint32Array(1), 1);

  constructor() {
    this.stamps = storage(this.stampsPlaceholder, 'uint', 1);
    this.table = storage(this.tablePlaceholder, 'uint', 1);
  }

  /** The placeholders' 8 bytes live with the renderer, which is the only
   *  thing that frees them. */
  setBuffers(stamps: StorageBufferAttribute | null, table: StorageBufferAttribute | null): void {
    this.stamps.value = stamps ?? this.stampsPlaceholder;
    this.table.value = table ?? this.tablePlaceholder;
  }

  slotOf(star: Node<'int'> | Node<'uint'>): ReturnType<UintStorageNode['element']> {
    return this.table.element(star);
  }

  /** The Morton bucket a star appends under. */
  bucketOf(count: number, star: Node<'int'> | Node<'uint'>): Node<'uint'> {
    return this.slotOf(star).div(uint(refillBucketCapacity(count)));
  }

  /** A star's entry inside `bucket`'s static region — the one place the
   *  address producer and refill kernel must agree on is written. */
  worklistElement(
    count: number, bucket: Node<'uint'>, offset: Node<'uint'>,
  ): ReturnType<UintStorageNode['element']> {
    return this.table.element(
      bucket.mul(uint(refillBucketCapacity(count))).add(offset).add(uint(count)));
  }

  /** A bucket's append counter inside the compaction's args buffer — the
   *  producer adds into it, the reset zeroes it and the scan reads it, all
   *  three through this one element. */
  counterElement(
    counters: UintStorageNode, bucket: Node<'uint'>,
  ): ReturnType<UintStorageNode['element']> {
    return counters.element(uint(REFILL_LIST_COUNT_BASE).add(bucket));
  }

  dispose(): void {
    this.setBuffers(null, null);
    this.arm.value = 0;
  }
}
