import { describe, expect, it } from 'vitest';
import { detectWebGpuSupport } from './webgpu-support';
import { parseGateOverride, parseRendererFlag } from '../renderer-flag';

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

describe('the gate override is opt-in and spelled out', () => {
  it('fires only on the exact value', () => {
    expect(parseGateOverride('#webgpu-gate=force')).toBe('force');
    expect(parseGateOverride('#renderer=webgpu&webgpu-gate=force')).toBe('force');
  });

  // A bare or mistyped fragment must not blank the app.
  it('ignores every other form', () => {
    for (const h of ['', '#', '#webgpu-gate', '#webgpu-gate=', '#webgpu-gate=1',
      '#webgpu-gate=true', '#renderer=webgpu']) {
      expect(parseGateOverride(h)).toBeNull();
    }
  });

  it('leaves the renderer flag alone', () => {
    expect(parseRendererFlag('#webgpu-gate=force')).toBeNull();
    expect(parseRendererFlag('#renderer=webgpu&webgpu-gate=force')).toBe('webgpu');
  });
});
