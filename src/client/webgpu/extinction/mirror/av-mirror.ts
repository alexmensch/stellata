// The A_V table on the CPU: one mapped copy of the GPU buffer, staged before
// a pick asks and answered from thereafter. README.md.

import type { StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';

export class AvMirror {
  private values: Float32Array | null = null;
  /** The generation the outstanding-or-landed copy belongs to. Holding it
   *  across the resolve is what makes a pointermove sweep cost one copy
   *  rather than one per event. */
  private staged = -1;
  /** Bumped by every `invalidate`, so a copy issued against a buffer that
   *  has since been rewritten is dropped rather than answering picks with
   *  what the GPU no longer holds. */
  private epoch = 0;
  private disposed = false;

  constructor(private readonly renderer: WebGPURenderer) {}

  read(idx: number): number | null {
    if (this.values === null) return null;
    return this.values[idx] ?? null;
  }

  /** The buffer this mirrors was rewritten. Call on every dispatch. */
  invalidate(): void {
    this.values = null;
    this.epoch++;
  }

  /** At most one copy per generation, and the caller decides when one is
   *  worth taking (README.md). */
  stage(av: StorageBufferAttribute, generation: number): void {
    if (this.staged === generation) return;
    this.staged = generation;
    const epoch = this.epoch;
    this.renderer
      .getArrayBufferAsync(av)
      .then((bytes) => {
        if (this.disposed || this.epoch !== epoch) return;
        this.values = new Float32Array(bytes);
      })
      .catch(() => {
        // Never re-armed: `staged` stands, so a device refusing the map
        // costs one attempt per generation rather than one per pointer event.
      });
  }

  dispose(): void {
    this.disposed = true;
    this.values = null;
    this.staged = -1;
  }
}
