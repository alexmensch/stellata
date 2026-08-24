import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { RenderTarget, type WebGPURenderer } from 'three/webgpu';
import { WebGpuHdrPipeline } from './hdr-pipeline-webgpu';
import { HDR_ATTACHMENT_COUNT } from '../../hdr/hdr-pipeline';

function fakeRenderer(reversedDepthBuffer = true) {
  const bound: (RenderTarget | null)[] = [];
  const renderer = {
    reversedDepthBuffer,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
    getPixelRatio: () => 2,
    setRenderTarget: (t: RenderTarget | null) => bound.push(t),
    render: () => {},
    readRenderTargetPixelsAsync: () => new Promise<Float32Array>(() => {}),
  };
  return { renderer: renderer as unknown as WebGPURenderer, bound };
}

function makeLayerRecorder() {
  const calls: boolean[] = [];
  return { calls, layer: { setMrtOutputs: (on: boolean) => calls.push(on) } };
}

// The WebGL seam's "no off switch" pin, same shape: supported is constant
// true here (float targets are core WebGPU), so chart is the ONLY input.
describe('the seam has no off switch', () => {
  it('wantsTarget stays two-input', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./hdr-pipeline-webgpu.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/setEnabled|HDR_DEFAULT_ENABLED/);
    expect(src).toContain('return this.supported && !this.chart;');
  });
});

describe('the target', () => {
  it('allocates lazily on bind, with the three-attachment contract', () => {
    const { renderer, bound } = fakeRenderer();
    const hdr = new WebGpuHdrPipeline(renderer);
    expect(bound).toHaveLength(0);
    hdr.bind();
    const rt = bound[0]!;
    expect(rt).toBeInstanceOf(RenderTarget);
    expect(rt.textures).toHaveLength(HDR_ATTACHMENT_COUNT);
    expect(rt.textures[1].format).toBe(THREE.RGFormat);
    expect(rt.textures[2].minFilter).toBe(THREE.LinearFilter);
    // depthBuffer without stencil or a depth texture: what lands three on
    // Depth32Float under reversedDepthBuffer.
    expect(rt.depthBuffer).toBe(true);
    expect(rt.stencilBuffer).toBe(false);
    expect(rt.depthTexture).toBe(null);
    expect(hdr.statisticTexture()).toBe(rt.textures[1]);
  });

  it('refuses a target whose depth attachment cannot be Depth32Float reversed-z', () => {
    // A renderer without reversedDepthBuffer lands the target on
    // fixed-point depth, which voids the local depth pass's K = 1
    // bracket (../../local-depth/bracket/README.md § Precision analysis).
    const { renderer } = fakeRenderer(false);
    const hdr = new WebGpuHdrPipeline(renderer);
    expect(() => hdr.bind()).toThrow(/Depth32Float/);
  });

  it('chart mode binds the canvas and parks the statistic', () => {
    const { renderer, bound } = fakeRenderer();
    const hdr = new WebGpuHdrPipeline(renderer);
    hdr.bind();
    hdr.setChartMode(true);
    hdr.bind();
    expect(bound[bound.length - 1]).toBeNull();
    expect(hdr.statisticTexture()).toBeNull();
    expect(hdr.emitterUniforms.uHdrTarget.value).toBe(0);
    hdr.setChartMode(false);
    hdr.bind();
    expect(bound[bound.length - 1]).not.toBeNull();
    expect(hdr.emitterUniforms.uHdrTarget.value).toBe(1);
  });

  it('the extra-attachments lever rebuilds single-attachment and back', () => {
    const { renderer, bound } = fakeRenderer();
    const hdr = new WebGpuHdrPipeline(renderer);
    hdr.bind();
    hdr.setExtraAttachmentsEnabled(false);
    hdr.bind();
    const single = bound[bound.length - 1]!;
    expect(single.textures).toHaveLength(1);
    expect(hdr.statisticTexture()).toBeNull();
    hdr.setExtraAttachmentsEnabled(true);
    hdr.bind();
    expect(bound[bound.length - 1]!.textures).toHaveLength(HDR_ATTACHMENT_COUNT);
  });
});

// The struct's member count must match the bound target's attachment
// count or pipeline creation fails — so the swap must track every mode
// input (README.md § The gate becomes the output struct).
describe('the output-struct swap', () => {
  it('applies the current mode on register and tracks chart + the lever', () => {
    const { renderer } = fakeRenderer();
    const hdr = new WebGpuHdrPipeline(renderer);
    const { calls, layer } = makeLayerRecorder();
    const unregister = hdr.registerMrtLayer(layer);
    expect(calls).toEqual([true]);
    hdr.setChartMode(true);
    expect(calls[calls.length - 1]).toBe(false);
    hdr.setChartMode(false);
    expect(calls[calls.length - 1]).toBe(true);
    hdr.setExtraAttachmentsEnabled(false);
    expect(calls[calls.length - 1]).toBe(false);
    unregister();
    const settled = calls.length;
    hdr.setExtraAttachmentsEnabled(true);
    expect(calls).toHaveLength(settled);
  });
});

describe('the summation taps lever', () => {
  it('zeroes the resolve radius only after the downsample ran, and restores', () => {
    const { renderer } = fakeRenderer();
    const hdr = new WebGpuHdrPipeline(renderer);
    hdr.bind();
    const { summation } = hdr as unknown as {
      summation: { nodes: { uRadiusTexels: { value: number } } };
    };
    hdr.resolve();
    const live = summation.nodes.uRadiusTexels.value;
    expect(live).toBeGreaterThan(0);
    hdr.setSummationTapsEnabled(false);
    hdr.resolve();
    expect(summation.nodes.uRadiusTexels.value).toBe(0);
    hdr.setSummationTapsEnabled(true);
    hdr.resolve();
    expect(summation.nodes.uRadiusTexels.value).toBe(live);
  });
});

describe('the statistic write mask', () => {
  it('composes the frame-cost lever and the adaptation park into one gate', () => {
    const { renderer } = fakeRenderer();
    const hdr = new WebGpuHdrPipeline(renderer);
    expect(hdr.gates.statisticWrites.value).toBe(1);
    hdr.setStatisticWritesParked(true);
    expect(hdr.gates.statisticWrites.value).toBe(0);
    hdr.setStatisticWritesEnabled(false);
    hdr.setStatisticWritesParked(false);
    // The lever still holds — the park's restore must not clobber it.
    expect(hdr.gates.statisticWrites.value).toBe(0);
    hdr.setStatisticWritesEnabled(true);
    expect(hdr.gates.statisticWrites.value).toBe(1);
  });
});
