// The chrome line stroke on the TSL path: three's own line fragment
// reproduced over the MRT output struct. See README.md.

import {
  Discard, materialColor, materialLineDashSize, materialLineGapSize,
  materialLineScale, materialOpacity, select, varying, vec4,
} from 'three/tsl';
import {
  CustomBlending, Line2NodeMaterial, LineBasicNodeMaterial, LineDashedNodeMaterial,
  NodeMaterial, NoBlending, OneFactor, OneMinusSrcAlphaFactor, SrcAlphaFactor,
  type Node,
} from 'three/webgpu';
import {
  finishMrtMaterial, finishMrtOutputMaterial, type MrtEmitterMaterial,
} from '../hdr/mrt-material';
import { srgbEncodeTsl } from '../tonemap-tsl';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { attrFloat } from '../tsl/tsl-shim';

/** The encode branch: README.md § The encode the built-in path lost. */
function strokeColour(u: SharedUniformNodes, rgb: Node<'vec3'>, alpha: Node<'float'>) {
  return select(
    u.uHdrTarget.lessThan(0.5),
    vec4(srgbEncodeTsl(rgb), alpha),
    vec4(rgb, alpha),
  );
}

function authoredColour(u: SharedUniformNodes) {
  return strokeColour(
    u, materialColor as unknown as Node<'vec3'>,
    materialOpacity as unknown as Node<'float'>);
}

function strokeMaterial<M extends NodeMaterial>(material: M, opacity: number): M {
  material.transparent = true;
  material.opacity = opacity;
  material.depthTest = true;
  material.depthWrite = false;
  return material;
}

export function buildChromeLineMaterial(
  u: SharedUniformNodes, opacity: number,
): MrtEmitterMaterial & { material: LineBasicNodeMaterial } {
  const material = strokeMaterial(new LineBasicNodeMaterial(), opacity);
  material.name = 'chrome-line-tsl';
  const built = finishMrtMaterial(material, () => ({
    colour: authoredColour(u), statistic: vec4(0.0), diffuse: vec4(0.0),
  }));
  return { ...built, material };
}

export function buildDashedChromeLineMaterial(
  u: SharedUniformNodes, dash: number, gap: number, opacity: number,
): MrtEmitterMaterial & { material: LineDashedNodeMaterial } {
  const material = strokeMaterial(new LineDashedNodeMaterial(), opacity);
  material.name = 'chrome-line-dashed-tsl';
  material.dashSize = dash;
  material.gapSize = gap;
  const built = finishMrtMaterial(material, () => {
    const phase = varying(attrFloat('lineDistance').mul(materialLineScale));
    Discard(phase.mod(materialLineDashSize.add(materialLineGapSize))
      .greaterThan(materialLineDashSize));
    return { colour: authoredColour(u), statistic: vec4(0.0), diffuse: vec4(0.0) };
  });
  return { ...built, material };
}

/** The fat stroke — README.md § The fat stroke keeps three's fragment.
 *  `transparent` stays FALSE at every opacity and the alpha composite is
 *  spelled out instead; `setFatChromeLineOpaque` is the only writer of
 *  either flag. */
export function buildFatChromeLineMaterial(
  u: SharedUniformNodes, opacity: number, widthPx: number,
): MrtEmitterMaterial & { material: Line2NodeMaterial } {
  const material = new Line2NodeMaterial();
  material.name = 'chrome-line-fat-tsl';
  material.opacity = opacity;
  material.linewidth = widthPx;
  material.worldUnits = false;
  material.depthTest = true;
  material.depthWrite = false;
  // Off to match the WebGL2 stroke, which leaves USE_ALPHA_TO_COVERAGE
  // undefined; the target carries one sample either way, so the coverage
  // term would fall back to a hard endcap discard regardless.
  material.alphaToCoverage = false;
  setFatChromeLineOpaque(material, false);
  const built = finishMrtOutputMaterial(material, (shaded) => ({
    colour: strokeColour(u, shaded.rgb, shaded.a),
    statistic: vec4(0.0),
    diffuse: vec4(0.0),
  }));
  return { ...built, material };
}

/** `Line2NodeMaterial` answers `transparent` by compositing against
 *  `viewportOpaqueMipTexture()` — a full-frame read per draw of the target
 *  it is drawing into — so the blend rides `CustomBlending` factors
 *  instead. Three keeps that state under `transparent: false`
 *  (`WebGPUPipelineUtils.createRenderPipeline` skips only NoBlending and
 *  opaque-NormalBlending) and still sorts the draw as transparent.
 *
 *  The four factors ARE what `NormalBlending` selects — the alpha pair is
 *  `One / OneMinusSrcAlpha`, not the colour pair, and leaving them to
 *  default off `blendSrc` would write `a² + dst·(1−a)` into the channel
 *  the resolve composites against. */
export function setFatChromeLineOpaque(material: Line2NodeMaterial, on: boolean) {
  material.transparent = false;
  material.blending = on ? NoBlending : CustomBlending;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  material.needsUpdate = true;
}
