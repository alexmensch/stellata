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
const WIDTH_PX = 2.4;
const RENDER_ORDER = -1;

const FAT_SPEC = {
  colour: COLOUR,
  opacity: OPACITY,
  widthPx: WIDTH_PX,
  points: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 0]),
  renderOrder: RENDER_ORDER,
};

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
  // inert here — neither differentiator the GLSL variant above sets may
  // appear on either TSL stroke.
  it('tsl: leaves no pass-specific differentiator on either variant', () => {
    const factory = tsl();
    const main = factory.solid(COLOUR, OPACITY);
    const local = factory.solid(COLOUR, OPACITY, true);
    // Not a cache-key compare: a NodeMaterial's key embeds a per-instance
    // node hash, so two identically-built strokes never match
    // (`../webgpu/tsl/README.md` § One program per material instance).
    expect(local.material.onBeforeCompile).toBe(main.material.onBeforeCompile);
    expect(local.material.constructor).toBe(main.material.constructor);
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
    const fat = factory.fat(FAT_SPEC);
    expect(live).toBe(3);
    solid.dispose();
    dashed.dispose();
    fat.dispose();
    expect(live).toBe(0);
  });
});

describe('the fat chrome stroke', () => {
  it.each(BACKENDS)('%s: authors colour, alpha and screen width alike', (_n, make) => {
    const fat = make().fat(FAT_SPEC);
    const expected = setBuiltinChromeColour(new THREE.Color(), COLOUR);
    expect(fat.material.color.getHex(THREE.LinearSRGBColorSpace))
      .toBe(expected.getHex(THREE.LinearSRGBColorSpace));
    expect(fat.material.opacity).toBe(OPACITY);
    expect(fat.material.linewidth).toBe(WIDTH_PX);
    expect(fat.material.depthTest).toBe(true);
    expect(fat.material.depthWrite).toBe(false);
    fat.dispose();
  });

  // The seam owns the primitive here, not `../util/orbit-line.ts`: the mesh
  // class is backend-specific and each refuses the other's material.
  it.each(BACKENDS)('%s: hands back a drawable at the requested order', (_n, make) => {
    const fat = make().fat(FAT_SPEC);
    expect(fat.object.renderOrder).toBe(RENDER_ORDER);
    expect(fat.object.frustumCulled).toBe(false);
    expect((fat.object as THREE.Mesh).material).toBe(fat.material);
    fat.dispose();
  });

  it('builtin: flips the blend through `transparent`, as every three material does', () => {
    const fat = builtinChromeLineMaterials().fat(FAT_SPEC);
    fat.setOpaque(true);
    expect(fat.material.transparent).toBe(false);
    expect(fat.material.blending).toBe(THREE.NoBlending);
    fat.setOpaque(false);
    expect(fat.material.transparent).toBe(true);
    expect(fat.material.blending).toBe(THREE.NormalBlending);
    fat.dispose();
  });

  // `Line2NodeMaterial` answers `transparent` by compositing against a
  // full-frame texture read of the target it draws into, so the flag stays
  // false at every opacity and the factors carry the blend instead
  // (`../webgpu/chrome-lines/README.md`).
  it('tsl: never sets `transparent`, and spells NormalBlending out instead', () => {
    const fat = tsl().fat(FAT_SPEC);
    fat.setOpaque(false);
    expect(fat.material.transparent).toBe(false);
    expect(fat.material.blending).toBe(THREE.CustomBlending);
    // Exactly what three's own NormalBlending selects — note the alpha pair
    // is NOT the colour pair.
    expect(fat.material.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(fat.material.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(fat.material.blendSrcAlpha).toBe(THREE.OneFactor);
    expect(fat.material.blendDstAlpha).toBe(THREE.OneMinusSrcAlphaFactor);
    fat.setOpaque(true);
    expect(fat.material.transparent).toBe(false);
    expect(fat.material.blending).toBe(THREE.NoBlending);
    fat.dispose();
  });
});
