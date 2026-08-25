import { describe, expect, it } from 'vitest';
import { detectWebGpuSupport } from './webgpu-support';

describe('the gate asks the browser, never its name', () => {
  it('passes when an adapter comes back', async () => {
    expect(await detectWebGpuSupport({ gpu: { requestAdapter: async () => ({}) } }))
      .toBe('supported');
  });

  it('reports no-api with navigator.gpu absent', async () => {
    expect(await detectWebGpuSupport({})).toBe('no-api');
  });

  // Present API, no device: a blocklisted driver, a flag left off, or a
  // software context that refused. Distinct from no-api in the return
  // value; the same page for the reader.
  it('reports no-adapter when the request yields null', async () => {
    expect(await detectWebGpuSupport({ gpu: { requestAdapter: async () => null } }))
      .toBe('no-adapter');
  });

  // This runs on the boot path, so a throw here would leave the user with
  // the dead canvas the gate exists to replace.
  it('treats a rejecting requestAdapter as no-adapter rather than propagating', async () => {
    await expect(detectWebGpuSupport({
      gpu: { requestAdapter: async () => { throw new Error('device lost'); } },
    })).resolves.toBe('no-adapter');
  });
});
