import { describe, expect, it, vi } from 'vitest';
import { resolveBootRoute } from './boot-route';
import type { WebGpuVerdict } from './gate/webgpu-support';

const probing = (verdict: WebGpuVerdict) => vi.fn(async () => verdict);

describe('resolveBootRoute', () => {
  it('boots with no fragment at all', async () => {
    const probe = probing('supported');
    expect(await resolveBootRoute('', probe)).toEqual({ kind: 'boot' });
    expect(probe).toHaveBeenCalledOnce();
  });

  it('gates on each failing verdict, carrying it to the page', async () => {
    expect(await resolveBootRoute('', probing('no-api')))
      .toEqual({ kind: 'gate', verdict: 'no-api' });
    expect(await resolveBootRoute('', probing('no-adapter')))
      .toEqual({ kind: 'gate', verdict: 'no-adapter' });
  });

  it('shows the forced gate on a browser that would pass the probe', async () => {
    const probe = probing('supported');
    expect(await resolveBootRoute('#webgpu-gate=force', probe))
      .toEqual({ kind: 'gate', verdict: 'no-api' });
    expect(await resolveBootRoute('#webgpu-gate=no-adapter', probe))
      .toEqual({ kind: 'gate', verdict: 'no-adapter' });
    expect(probe).not.toHaveBeenCalled();
  });

  // The probe is the only thing that decides a boot, so a fragment naming
  // a renderer is inert rather than a second route.
  it('probes regardless of any other fragment param', async () => {
    const probe = probing('supported');
    expect(await resolveBootRoute('#renderer=webgl2', probe)).toEqual({ kind: 'boot' });
    expect(probe).toHaveBeenCalledOnce();
  });
});
