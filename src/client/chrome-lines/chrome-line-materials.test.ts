import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { setBuiltinChromeColour } from '../hdr/chrome/chrome-colour';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../webgpu/tsl/shared-uniform-nodes';
import { makeTslChromeLineMaterials } from '../webgpu/chrome-lines/tsl-chrome-lines';
import { builtinChromeLineMaterials } from './builtin-chrome-lines';
import type { ChromeLineMaterials } from './chrome-line-materials';

const COLOUR = 0x9fc2d6;
const OPACITY = 0.5;
const DASH_PX = 1.5;
const GAP_PX = 4;

function sharedNodes() {
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600,
    hdr: makeHdrEmitterUniforms(),
  });
  return buildSharedUniformNodes(shared).nodes;
}

function tsl(registerMrtLayer = () => () => {}): ChromeLineMaterials {
  return makeTslChromeLineMaterials({ nodes: sharedNodes(), registerMrtLayer });
}

const BACKENDS: readonly [string, () => ChromeLineMaterials][] = [
  ['builtin', builtinChromeLineMaterials],
  ['tsl', () => tsl()],
];

describe('the chrome line seam', () => {
  it.each(BACKENDS)('%s: authors the stroke through the builtin chrome map', (_n, make) => {
    const stroke = make().solid(COLOUR, OPACITY);
    // Not the raw setter: these materials emit linear working-space
    // components into the target on both backends
    // (`../hdr/chrome/README.md`).
    const expected = setBuiltinChromeColour(new THREE.Color(), COLOUR);
    expect(stroke.material.color.getHex(THREE.LinearSRGBColorSpace))
      .toBe(expected.getHex(THREE.LinearSRGBColorSpace));
    stroke.dispose();
  });

  it.each(BACKENDS)('%s: composites without writing depth', (_n, make) => {
    const stroke = make().solid(COLOUR, OPACITY);
    expect(stroke.material.transparent).toBe(true);
    expect(stroke.material.opacity).toBe(OPACITY);
    expect(stroke.material.depthTest).toBe(true);
    expect(stroke.material.depthWrite).toBe(false);
    stroke.dispose();
  });

  it.each(BACKENDS)('%s: carries the dash pattern on the material', (_n, make) => {
    const stroke = make().dashed(COLOUR, DASH_PX, GAP_PX, OPACITY);
    expect(stroke.material.dashSize).toBe(DASH_PX);
    expect(stroke.material.gapSize).toBe(GAP_PX);
    // The layer drives `scale` from the live FOV each frame; the factory
    // leaves three's own unit default.
    expect(stroke.material.scale).toBe(1);
    stroke.dispose();
  });

  // The GLSL-only argument: `localPass` strips the log-depth chunks, and a
  // stripped program needs its own cache key or three hands back the
  // unstripped one it already compiled for the main pass.
  it('builtin: keys the local-pass variant separately, and only that one', () => {
    const main = builtinChromeLineMaterials().solid(COLOUR, OPACITY);
    const local = builtinChromeLineMaterials().solid(COLOUR, OPACITY, true);
    expect(main.material.customProgramCacheKey()).not.toBe(
      local.material.customProgramCacheKey());
    main.dispose();
    local.dispose();
  });

  // Reversed-z deleted the chunks `localPass` would strip, so the flag is
  // inert here and one graph serves both passes.
  it('tsl: builds the same graph for both passes', () => {
    const factory = tsl();
    const main = factory.solid(COLOUR, OPACITY);
    const local = factory.solid(COLOUR, OPACITY, true);
    expect(local.material.name).toBe(main.material.name);
    main.dispose();
    local.dispose();
  });

  it('tsl: registers each stroke for the output-struct swap and severs on dispose', () => {
    let live = 0;
    const factory = tsl(() => {
      live++;
      return () => { live--; };
    });
    const solid = factory.solid(COLOUR, OPACITY);
    const dashed = factory.dashed(COLOUR, DASH_PX, GAP_PX, OPACITY);
    expect(live).toBe(2);
    solid.dispose();
    dashed.dispose();
    expect(live).toBe(0);
  });
});
