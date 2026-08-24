// Whether this backend's timestamp queries survive validation. Safari 26
// advertises 'timestamp-query' and then reports the query set's type as an
// unknown enum (README.md § Timestamps).

// GPUTextureUsage.RENDER_ATTACHMENT — read as a literal because the
// global is browser-only, and reaching for it here would make the probe
// throw under vitest and report every backend broken.
const RENDER_ATTACHMENT = 0x10;

interface Releasable {
  destroy(): void;
}

export interface ProbePassDescriptor {
  colorAttachments: {
    view: unknown;
    loadOp: 'clear';
    storeOp: 'store';
    clearValue: { r: number; g: number; b: number; a: number };
  }[];
  timestampWrites: {
    querySet: unknown;
    beginningOfPassWriteIndex: number;
    endOfPassWriteIndex: number;
  };
}

/** The slice of GPUDevice the probe drives, structurally — the project
 *  pulls in no WebGPU type package, so the globals do not exist here
 *  (loaders/dust-voxel-readback.ts takes the same route). */
export interface ProbeDevice {
  pushErrorScope(filter: 'validation'): void;
  popErrorScope(): Promise<unknown>;
  createQuerySet(descriptor: { type: 'timestamp'; count: number }): Releasable;
  createTexture(descriptor: {
    size: [number, number];
    format: 'rgba8unorm';
    usage: number;
  }): Releasable & { createView(): unknown };
  createCommandEncoder(): {
    beginRenderPass(descriptor: ProbePassDescriptor): { end(): void };
    finish(): unknown;
  };
  queue: { submit(buffers: unknown[]): void };
}

/** Backend internals the probe drives — @types/three exposes neither. */
export interface TimestampBackend {
  device: ProbeDevice;
  trackTimestamp: boolean;
}

/** One throwaway timestamped render pass inside a validation scope.
 *  False when the backend rejects it. */
export async function timestampWritesValidate(device: ProbeDevice): Promise<boolean> {
  device.pushErrorScope('validation');
  let querySet: Releasable | null = null;
  let texture: (Releasable & { createView(): unknown }) | null = null;
  try {
    querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    texture = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: RENDER_ATTACHMENT,
    });
    const encoder = device.createCommandEncoder();
    encoder.beginRenderPass({
      colorAttachments: [{
        view: texture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
      timestampWrites: {
        querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
      },
    }).end();
    device.queue.submit([encoder.finish()]);
  } catch {
    await device.popErrorScope();
    return false;
  } finally {
    querySet?.destroy();
    texture?.destroy();
  }
  return (await device.popErrorScope()) === null;
}

/** Must run before the first frame: three caches the render pass
 *  descriptor per render target and never clears a `timestampWrites` it
 *  already attached, so a descriptor built while this is still true stays
 *  poisoned for the backend's lifetime. Returns whether timestamps live. */
export async function settleTimestampSupport(backend: TimestampBackend): Promise<boolean> {
  if (!backend.trackTimestamp) return false;
  if (await timestampWritesValidate(backend.device)) return true;
  backend.trackTimestamp = false;
  return false;
}
