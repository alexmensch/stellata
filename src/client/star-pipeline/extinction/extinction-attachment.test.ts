import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SharedUniforms } from '../../frame/shared-uniforms';
import type { DustField } from '../../loaders/dust-loader';
import type { FrameCtx } from '../../scene/scene-layer';
import { ExtinctionAttachment, type ExtinctionAttachmentDeps } from './extinction-attachment';
import type { ExtinctionPrepassSeam } from './extinction-seam';

function fakePrepass(av: number | null = 0.5) {
  return {
    markDirty: vi.fn(),
    refreshPositions: vi.fn(),
    setEnabled: vi.fn(),
    isActive: vi.fn(() => true),
    update: vi.fn(),
    readAvMag: vi.fn(() => av),
    warmAvReadback: vi.fn(),
    countInFrame: vi.fn(() => 7),
    verifyParity: vi.fn(async () => null),
    dispose: vi.fn(),
  } satisfies ExtinctionPrepassSeam;
}

function fakeDust() {
  const listeners: (() => void)[] = [];
  const dust = {
    texture: new THREE.Data3DTexture(),
    params: { boundsHalfPc: 1250, densityMin: 1e-6, logRatio: 5, avPerDensityPerPc: 3 },
    onProgress: (h: () => void) => { listeners.push(h); },
    dispose: vi.fn(() => { listeners.length = 0; }),
  };
  return { dust: dust as unknown as DustField, dispose: dust.dispose, progress: () => listeners.forEach((h) => h()) };
}

function makeAttachment(prepass = fakePrepass()) {
  const uniforms = {
    uDustTexture: { value: null as THREE.Data3DTexture | null },
    uDustBoundsPc: { value: 0 },
    uDustDensityMin: { value: 0 },
    uDustLogRatio: { value: 0 },
    uDustAvPerDensityPc: { value: 0 },
    uDustEnabled: { value: 0 },
    uExtinctionStrength: { value: 1 },
  };
  const deps = {
    catalog: { positions: new Float32Array(0), count: 0, loadedCount: 0 },
    uniforms: uniforms as unknown as SharedUniforms,
    webgpu: { setDustTexture: vi.fn(), attachExtinctionPrepass: vi.fn(() => prepass) },
    milkyway: { attachDust: vi.fn(), setExtinctionStrength: vi.fn() },
    renderer: {} as ExtinctionAttachmentDeps['renderer'],
    invalidate: vi.fn(),
  };
  const attachment = new ExtinctionAttachment(deps as unknown as ExtinctionAttachmentDeps);
  const ctx = {
    camera: new THREE.PerspectiveCamera(),
    worldOffset: new THREE.Vector3(),
  } as unknown as FrameCtx;
  return { attachment, deps, uniforms, prepass, ctx };
}

describe('ExtinctionAttachment', () => {
  it('is inert before attach', () => {
    const { attachment, prepass, ctx } = makeAttachment();
    attachment.update(ctx);
    attachment.refreshPositions();
    attachment.warmPickReadback();
    expect(prepass.update).not.toHaveBeenCalled();
    expect(attachment.isPrepassActive()).toBe(false);
    expect(attachment.avMagAt(0)).toBe(null);
    expect(attachment.countInFrame()).toBe(null);
  });

  it('wires the field into the uniforms, the seam and the band, and dirties the cache', () => {
    const { attachment, deps, uniforms, prepass } = makeAttachment();
    const { dust } = fakeDust();
    attachment.attach(dust);
    expect(uniforms.uDustTexture.value).toBe(dust.texture);
    expect(uniforms.uDustBoundsPc.value).toBe(1250);
    expect(uniforms.uDustAvPerDensityPc.value).toBe(3);
    expect(uniforms.uDustEnabled.value).toBe(1);
    expect(deps.webgpu.setDustTexture).toHaveBeenCalledWith(dust.texture);
    expect(deps.milkyway.attachDust).toHaveBeenCalledWith(dust);
    expect(deps.invalidate).toHaveBeenCalledWith('attach:dust');
    expect(prepass.markDirty).toHaveBeenCalledTimes(1);
  });

  it('dirties the cache and wakes the gate on every streamed chunk', () => {
    const { attachment, deps, prepass } = makeAttachment();
    const f = fakeDust();
    attachment.attach(f.dust);
    f.progress();
    expect(prepass.markDirty).toHaveBeenCalledTimes(2);
    expect(deps.invalidate).toHaveBeenCalledWith('dust-chunk');
  });

  it('a missing manifest concludes the slot and wires nothing', () => {
    const { attachment, deps, uniforms } = makeAttachment();
    attachment.attach(null);
    expect(deps.webgpu.attachExtinctionPrepass).not.toHaveBeenCalled();
    expect(deps.webgpu.setDustTexture).not.toHaveBeenCalled();
    expect(deps.milkyway.attachDust).not.toHaveBeenCalled();
    expect(uniforms.uDustEnabled.value).toBe(0);
  });

  it('settles once: a second attach throws, whichever settled it', () => {
    const attached = makeAttachment();
    attached.attachment.attach(fakeDust().dust);
    expect(() => attached.attachment.attach(fakeDust().dust)).toThrow(/already settled/);
    const concluded = makeAttachment();
    concluded.attachment.attach(null);
    expect(() => concluded.attachment.attach(fakeDust().dust)).toThrow(/already settled/);
    expect(concluded.deps.webgpu.attachExtinctionPrepass).not.toHaveBeenCalled();
  });

  it('a chunk landing after dispose reaches no released prepass', () => {
    const { attachment, prepass } = makeAttachment();
    const f = fakeDust();
    attachment.attach(f.dust);
    attachment.dispose();
    f.progress();
    expect(prepass.markDirty).toHaveBeenCalledTimes(1);
    expect(attachment.isPrepassActive()).toBe(false);
  });

  it('hands the prepass the frame context as its view', () => {
    const { attachment, prepass, ctx } = makeAttachment();
    attachment.attach(fakeDust().dust);
    attachment.update(ctx);
    expect(prepass.update).toHaveBeenLastCalledWith(ctx);
  });

  it('forced recompute dirties the cache before every update', () => {
    const { attachment, prepass, ctx } = makeAttachment();
    attachment.attach(fakeDust().dust);
    attachment.setRecomputeForced(true);
    attachment.update(ctx);
    attachment.update(ctx);
    expect(prepass.markDirty).toHaveBeenCalledTimes(3);
    expect(attachment.isRecomputeForced()).toBe(true);
  });

  it('scales the raw A_V by enable and strength, and floors strength at zero', () => {
    const { attachment, deps } = makeAttachment(fakePrepass(0.5));
    attachment.attach(fakeDust().dust);
    attachment.setStrength(2);
    expect(attachment.avMagAt(0)).toBe(1);
    attachment.setStrength(-1);
    expect(attachment.avMagAt(0)).toBe(0);
    expect(deps.milkyway.setExtinctionStrength).toHaveBeenLastCalledWith(-1);
  });

  it('answers null while the mirror is cold', () => {
    const { attachment } = makeAttachment(fakePrepass(null));
    attachment.attach(fakeDust().dust);
    expect(attachment.avMagAt(0)).toBe(null);
  });

  it('the console checks tell a loading manifest from no dust', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pending = makeAttachment();
    expect(await pending.attachment.verifyDust()).toEqual([]);
    expect(await pending.attachment.verifyParity()).toBe(null);
    const absent = makeAttachment();
    absent.attachment.attach(null);
    expect(await absent.attachment.verifyDust()).toEqual([]);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'verifyDust: the dust manifest is still loading',
      'verifyParity: the dust manifest is still loading',
      'verifyDust: no dust this session',
    ]);
    warn.mockRestore();
  });

  it('dispose releases the prepass and the field', () => {
    const { attachment, prepass } = makeAttachment();
    const f = fakeDust();
    attachment.attach(f.dust);
    attachment.dispose();
    expect(prepass.dispose).toHaveBeenCalledTimes(1);
    expect(f.dispose).toHaveBeenCalledTimes(1);
  });
});
