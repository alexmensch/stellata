import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SummationPass } from './summation-pass';
import { summationDownsample, summationRadiusPx } from './summation-pure';
import { pixelSolidAngleArcsec2 } from '../emission/emission-pure';
import { DEFAULT_SUMMATION_ARCSEC2 } from '../exposure/exposure-epoch';
import { angularToPx } from '../../camera/controls/star-geometry';
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../../camera/timing';

/** Everything `SummationPass` asks of a renderer, plus a log of the calls it
 *  must NOT make. Constructing the real class needs no GL context — the
 *  target, the geometry and the material are all inert until a renderer binds
 *  them — so the pass can be driven for real here. */
function fakeRenderer(cssHeight: number, pixelRatio: number) {
  const forbidden: string[] = [];
  const bound: (THREE.WebGLRenderTarget | null)[] = [];
  const renderer = {
    getDrawingBufferSize: (v: THREE.Vector2) =>
      v.set(cssHeight * 2 * pixelRatio, cssHeight * pixelRatio),
    getPixelRatio: () => pixelRatio,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => bound.push(t),
    render: () => {},
    setViewport: () => forbidden.push('setViewport'),
    setScissor: () => forbidden.push('setScissor'),
    setScissorTest: () => forbidden.push('setScissorTest'),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, forbidden, bound };
}

const omegaPxFor = (fovDeg: number, cssHeight: number) =>
  pixelSolidAngleArcsec2(angularToPx(cssHeight, (fovDeg * Math.PI) / 180));

/** Drive one frame at a FOV and a device pixel ratio. */
function frame(fovDeg: number, pixelRatio: number, cssHeight = 900) {
  const { renderer, forbidden, bound } = fakeRenderer(cssHeight, pixelRatio);
  const pass = new SummationPass(renderer);
  pass.render(
    new THREE.Texture(),
    DEFAULT_SUMMATION_ARCSEC2,
    omegaPxFor(fovDeg, cssHeight),
  );
  const target = bound[0] ?? null;
  return { pass, forbidden, target, bound };
}

// The sub-rect has to ride the render target's own viewport. renderer.setViewport
// takes CSS units and three multiplies them by pixelRatio when it applies them,
// while every number in this pass is a drawing-buffer pixel — and worse, it
// rewrites the renderer's persistent canvas viewport, which setRenderTarget(null)
// then reapplies for the resolve and every frame after it. At devicePixelRatio 2
// the two errors cancel by coincidence; at 1 the tone-map resolve lands in a
// quarter of the canvas, and it stays there, because a later frame that needs no
// downsample returns before touching the viewport again.
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

// The factor is chosen from DRAWING-BUFFER pixels, so devicePixelRatio is part
// of its domain — a kernel sized in CSS px would come out `pixelRatio` times
// too small, which reads as the convolution quietly doing nothing on a retina
// display. This is the behavioural half of what summation-pure.test.ts pins
// arithmetically.
describe('the pixel ratio the factor is chosen at', () => {
  it('doubles the patch in texels before the factor sees it', () => {
    const one = frame(FOV_MIN_DEG, 1);
    const two = frame(FOV_MIN_DEG, 2);
    const radiusCss = summationRadiusPx(
      DEFAULT_SUMMATION_ARCSEC2,
      omegaPxFor(FOV_MIN_DEG, 900),
    );
    expect(one.pass.uniforms.uSummationTexelScale.value).toBeCloseTo(
      1 / summationDownsample(radiusCss),
      12,
    );
    expect(two.pass.uniforms.uSummationTexelScale.value).toBeCloseTo(
      1 / summationDownsample(radiusCss * 2),
      12,
    );
  });

  // Still inside the loop bound at the worst reachable case: the narrowest FOV
  // on the tallest viewport a browser reports, at the pixel-ratio cap. Past
  // MAX_KERNEL_REACH_TEXELS the GLSL loop would truncate the disc into a
  // lopsided average rather than fail to compile.
  it('keeps the kernel under the shader’s reach at the pixel-ratio cap', () => {
    const { pass } = frame(FOV_MIN_DEG, 2, 2160);
    expect(pass.uniforms.uSummationRadiusTexels.value).toBeLessThan(4.5);
  });
});

describe('the source the resolve reads', () => {
  it('is the diffuse attachment itself while the patch is small', () => {
    const diffuse = new THREE.Texture();
    const { renderer, bound } = fakeRenderer(900, 2);
    const pass = new SummationPass(renderer);
    pass.render(diffuse, DEFAULT_SUMMATION_ARCSEC2, omegaPxFor(FOV_MAX_DEG, 900));
    expect(bound).toEqual([]);
    expect(pass.uniforms.uDiffuseTexture.value).toBe(diffuse);
    expect(pass.uniforms.uSummationTexelScale.value).toBe(1);
    expect(pass.uniforms.uSummationExtent.value.toArray()).toEqual([3600, 1800]);
  });

  it('is the downsample target once a factor is needed, at its live extent', () => {
    const { pass, target } = frame(FOV_MIN_DEG, 2);
    expect(pass.uniforms.uDiffuseTexture.value).toBe(target!.texture);
    expect(pass.uniforms.uSummationExtent.value.toArray()).toEqual(
      target!.viewport.toArray().slice(2),
    );
  });

  // Sized for the widest factor and never resized per frame, so a continuous
  // zoom cannot reallocate a render target mid-gesture.
  it('allocates half the drawing buffer whatever the factor', () => {
    for (const fovDeg of [FOV_MIN_DEG, 20, 30]) {
      const { target } = frame(fovDeg, 2);
      if (target === null) continue;
      expect([target.width, target.height]).toEqual([1800, 900]);
    }
  });
});
