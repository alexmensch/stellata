// The A_V table on the CPU: one mapped copy of the GPU buffer, staged before
// a pick asks and answered from thereafter. README.md.

import type { StorageBufferAttribute, WebGPURenderer } from 'three/webgpu';

type InFlight = { readonly status: 'in-flight' };

/** The copy of the buffer's current contents (README.md#the-copys-four-states). */
type MirrorCopy =
  | { readonly status: 'unstaged' }
  | InFlight
  | { readonly status: 'landed'; readonly values: Float32Array }
  | { readonly status: 'failed' };

const UNSTAGED: MirrorCopy = { status: 'unstaged' };
const FAILED: MirrorCopy = { status: 'failed' };

export class AvMirror {
  private copy: MirrorCopy = UNSTAGED;

  constructor(private readonly renderer: WebGPURenderer) {}

  /** Null is "no answer yet", never "no dust". */
  read(idx: number): number | null {
    if (this.copy.status !== 'landed') return null;
    return this.copy.values[idx] ?? null;
  }

  /** The buffer this mirrors was rewritten. Call on every dispatch. */
  invalidate(): void {
    this.copy = UNSTAGED;
  }

  /** At most one copy per invalidate, and the caller decides when one is
   *  worth taking (README.md). */
  stage(av: StorageBufferAttribute): void {
    if (this.copy.status !== 'unstaged') return;
    const inFlight: InFlight = { status: 'in-flight' };
    this.copy = inFlight;
    this.renderer
      .getArrayBufferAsync(av)
      .then((bytes) => {
        if (this.copy === inFlight) this.copy = { status: 'landed', values: new Float32Array(bytes) };
      })
      .catch(() => {
        if (this.copy === inFlight) this.copy = FAILED;
      });
  }

  dispose(): void {
    this.copy = UNSTAGED;
  }
}
