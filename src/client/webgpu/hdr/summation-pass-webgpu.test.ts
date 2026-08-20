import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RenderTarget, type Texture, type WebGPURenderer } from 'three/webgpu';
import { WebGpuSummationPass } from './summation-pass-webgpu';
import {
  summationDownsample, summationRadiusPx,
} from '../../hdr/summation/summation-pure';
import { pixelSolidAngleArcsec2 } from '../../hdr/emission/emission-pure';
import { DEFAULT_SUMMATION_ARCSEC2 } from '../../hdr/exposure/exposure-epoch';
import { angularToPx } from '../../camera/controls/star-geometry';
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../../camera/timing';

/** Everything the pass asks of a renderer, plus a log of the calls it must
 *  NOT make — the same contract summation-pass.test.ts drives the WebGL
 *  twin against. */
function fakeRenderer(cssHeight: number, pixelRatio: number) {
  const forbidden: string[] = [];
  const bound: (RenderTarget | null)[] = [];
  const renderer = {
    getDrawingBufferSize: (v: THREE.Vector2) =>
      v.set(cssHeight * 2 * pixelRatio, cssHeight * pixelRatio),
    getPixelRatio: () => pixelRatio,
    setRenderTarget: (t: RenderTarget | null) => bound.push(t),
    render: () => {},
    setViewport: () => forbidden.push('setViewport'),
    setScissor: () => forbidden.push('setScissor'),
    setScissorTest: () => forbidden.push('setScissorTest'),
  };
  return { renderer: renderer as unknown as WebGPURenderer, forbidden, bound };
}

const omegaPxFor = (fovDeg: number, cssHeight: number) =>
  pixelSolidAngleArcsec2(angularToPx(cssHeight, (fovDeg * Math.PI) / 180));

function frame(fovDeg: number, pixelRatio: number, cssHeight = 900) {
  const { renderer, forbidden, bound } = fakeRenderer(cssHeight, pixelRatio);
  const diffuse = new THREE.Texture() as unknown as Texture;
  const pass = new WebGpuSummationPass(renderer, diffuse);
  pass.render(diffuse, DEFAULT_SUMMATION_ARCSEC2, omegaPxFor(fovDeg, cssHeight));
  return { pass, diffuse, forbidden, target: bound[0] ?? null };
}

describe('the downsample sub-rect', () => {
  it('never touches the renderer’s own viewport or scissor state', () => {
    for (const pixelRatio of [1, 1.5, 2]) {
      expect(frame(FOV_MIN_DEG, pixelRatio).forbidden).toEqual([]);
    }
  });

  it('is the target’s viewport, scissored to the live texels', () => {
    const { target } = frame(FOV_MIN_DEG, 2);
    const factor = summationDownsample(
      summationRadiusPx(DEFAULT_SUMMATION_ARCSEC2, omegaPxFor(FOV_MIN_DEG, 900)) * 2,
    );
    const expected = [0, 0, Math.ceil(3600 / factor), Math.ceil(1800 / factor)];
    expect(target).not.toBeNull();
    expect(target!.viewport.toArray()).toEqual(expected);
    expect(target!.scissor.toArray()).toEqual(expected);
    expect(target!.scissorTest).toBe(true);
  });
});

describe('what the resolve is handed', () => {
  it('at a wide FOV the factor is 1: the raw attachment, full extent, no draw', () => {
    const { pass, diffuse, target } = frame(FOV_MAX_DEG, 2);
    expect(target).toBeNull();
    expect(pass.nodes.uDiffuse.value).toBe(diffuse);
    expect(pass.nodes.uTexelScale.value).toBe(1);
    expect(pass.nodes.uExtent.value.toArray()).toEqual([3600, 1800]);
  });

  it('at a narrow FOV the downsampled copy takes over, radius rescaled to its texels', () => {
    const { pass, target } = frame(FOV_MIN_DEG, 2);
    const radiusPx =
      summationRadiusPx(DEFAULT_SUMMATION_ARCSEC2, omegaPxFor(FOV_MIN_DEG, 900)) * 2;
    const factor = summationDownsample(radiusPx);
    expect(factor).toBeGreaterThan(1);
    expect(pass.nodes.uDiffuse.value).toBe(target!.texture);
    expect(pass.nodes.uTexelScale.value).toBe(1 / factor);
    expect(pass.nodes.uRadiusTexels.value).toBeCloseTo(radiusPx / factor, 12);
  });

  // The factor is chosen from DRAWING-BUFFER pixels — a kernel sized in CSS
  // px would come out pixelRatio times too small, the convolution quietly
  // doing nothing on a retina display.
  it('crosses the device pixel ratio before choosing the factor', () => {
    const radiusCss = summationRadiusPx(
      DEFAULT_SUMMATION_ARCSEC2, omegaPxFor(FOV_MIN_DEG, 900));
    expect(frame(FOV_MIN_DEG, 1).pass.nodes.uTexelScale.value)
      .toBeCloseTo(1 / summationDownsample(radiusCss), 12);
    expect(frame(FOV_MIN_DEG, 2).pass.nodes.uTexelScale.value)
      .toBeCloseTo(1 / summationDownsample(radiusCss * 2), 12);
  });
});
