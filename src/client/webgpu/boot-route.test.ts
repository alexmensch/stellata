import { describe, expect, it, vi } from 'vitest';
import { resolveBootRoute } from './boot-route';
import type { WebGpuVerdict } from './gate/webgpu-support';

const probing = (verdict: WebGpuVerdict) => vi.fn(async () => verdict);

describe('resolveBootRoute', () => {
  it('boots WebGPU with no fragment at all', async () => {
    const probe = probing('supported');
    expect(await resolveBootRoute('', probe)).toEqual({ kind: 'boot', renderer: 'webgpu' });
    expect(probe).toHaveBeenCalledOnce();
  });

  it('gates on each failing verdict, carrying it to the page', async () => {
    expect(await resolveBootRoute('', probing('no-api')))
      .toEqual({ kind: 'gate', verdict: 'no-api' });
    expect(await resolveBootRoute('', probing('no-adapter')))
      .toEqual({ kind: 'gate', verdict: 'no-adapter' });
  });

  it('takes the escape hatch without asking the GPU', async () => {
    const probe = probing('no-api');
    expect(await resolveBootRoute('#renderer=webgl2', probe))
      .toEqual({ kind: 'boot', renderer: 'webgl2' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('still probes when WebGPU is named explicitly', async () => {
    const probe = probing('supported');
    expect(await resolveBootRoute('#renderer=webgpu', probe))
      .toEqual({ kind: 'boot', renderer: 'webgpu' });
    expect(probe).toHaveBeenCalledOnce();
  });

  it('shows the forced gate on a browser that would pass the probe', async () => {
    const probe = probing('supported');
    expect(await resolveBootRoute('#webgpu-gate=force', probe))
      .toEqual({ kind: 'gate', verdict: 'no-api' });
    expect(await resolveBootRoute('#webgpu-gate=no-adapter', probe))
      .toEqual({ kind: 'gate', verdict: 'no-adapter' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('lets the gate override win over the escape hatch', async () => {
    const probe = probing('supported');
    expect(await resolveBootRoute('#renderer=webgl2&webgpu-gate=force', probe))
      .toEqual({ kind: 'gate', verdict: 'no-api' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('ignores an unparseable renderer value and boots the default', async () => {
    expect(await resolveBootRoute('#renderer=metal', probing('supported')))
      .toEqual({ kind: 'boot', renderer: 'webgpu' });
  });
});
