import { describe, expect, it, vi } from 'vitest';
import {
  settleTimestampSupport, timestampWritesValidate,
  type ProbeDevice, type ProbePassDescriptor, type TimestampBackend,
} from './timestamp-probe';

interface Recorder {
  device: ProbeDevice;
  passDescriptors: ProbePassDescriptor[];
  destroyed: string[];
  scopesOpened: number;
  scopesPopped: number;
}

/** `error` is what popErrorScope resolves to; `throwOn` names a call that
 *  rejects outright, the way a backend refusing the query set does. */
function mockDevice(
  { error = null, throwOn = '' }: { error?: unknown; throwOn?: string } = {},
): Recorder {
  const rec: Partial<Recorder> = {
    passDescriptors: [], destroyed: [], scopesOpened: 0, scopesPopped: 0,
  };
  const end = vi.fn();
  const device = {
    pushErrorScope: () => { rec.scopesOpened! += 1; },
    popErrorScope: () => {
      rec.scopesPopped! += 1;
      return Promise.resolve(error);
    },
    createQuerySet: () => {
      if (throwOn === 'createQuerySet') throw new Error('rejected');
      return { destroy: () => rec.destroyed!.push('querySet') };
    },
    createTexture: () => ({
      createView: () => ({ __view: true }),
      destroy: () => rec.destroyed!.push('texture'),
    }),
    createCommandEncoder: () => ({
      beginRenderPass: (d: ProbePassDescriptor) => {
        rec.passDescriptors!.push(d);
        return { end };
      },
      finish: () => ({ __commandBuffer: true }),
    }),
    queue: { submit: vi.fn() },
  };
  rec.device = device as unknown as ProbeDevice;
  return rec as Recorder;
}

describe('timestampWritesValidate', () => {
  it('is true when the validation scope comes back clean', async () => {
    const rec = mockDevice();
    expect(await timestampWritesValidate(rec.device)).toBe(true);
  });

  it('is false when the backend reports a validation error', async () => {
    const rec = mockDevice({ error: { message: 'query type is not timestamp' } });
    expect(await timestampWritesValidate(rec.device)).toBe(false);
  });

  it('is false when the query set is refused outright', async () => {
    const rec = mockDevice({ throwOn: 'createQuerySet' });
    expect(await timestampWritesValidate(rec.device)).toBe(false);
  });

  // The probe is worthless if it validates a pass that never carried the
  // binding the real frames carry.
  it('drives a pass that actually carries timestampWrites', async () => {
    const rec = mockDevice();
    await timestampWritesValidate(rec.device);
    expect(rec.passDescriptors).toHaveLength(1);
    const writes = rec.passDescriptors[0].timestampWrites;
    expect(writes).toBeDefined();
    expect(writes!.beginningOfPassWriteIndex).toBe(0);
    expect(writes!.endOfPassWriteIndex).toBe(1);
    expect(writes!.querySet).toBeDefined();
  });

  it('pops every scope it opens, and releases both resources', async () => {
    for (const opts of [{}, { error: { message: 'x' } }, { throwOn: 'createQuerySet' }]) {
      const rec = mockDevice(opts);
      await timestampWritesValidate(rec.device);
      expect(rec.scopesOpened).toBe(1);
      expect(rec.scopesPopped).toBe(1);
    }
  });

  it('releases the query set and the texture on the clean path', async () => {
    const rec = mockDevice();
    await timestampWritesValidate(rec.device);
    expect(rec.destroyed.sort()).toEqual(['querySet', 'texture']);
  });
});

describe('settleTimestampSupport', () => {
  const backendOn = (device: ProbeDevice): TimestampBackend =>
    ({ device, trackTimestamp: true });

  it('leaves tracking on when the probe validates', async () => {
    const backend = backendOn(mockDevice().device);
    expect(await settleTimestampSupport(backend)).toBe(true);
    expect(backend.trackTimestamp).toBe(true);
  });

  // Safari 26: the feature is advertised, the query set is still refused,
  // and a descriptor cached while this stayed true voids every submit.
  it('turns tracking off when the probe is refused', async () => {
    const backend = backendOn(mockDevice({ error: { message: 'nope' } }).device);
    expect(await settleTimestampSupport(backend)).toBe(false);
    expect(backend.trackTimestamp).toBe(false);
  });

  it('does not probe when tracking is already off', async () => {
    const rec = mockDevice();
    const backend: TimestampBackend = { device: rec.device, trackTimestamp: false };
    expect(await settleTimestampSupport(backend)).toBe(false);
    expect(rec.scopesOpened).toBe(0);
  });
});
