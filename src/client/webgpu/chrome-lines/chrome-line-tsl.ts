// The chrome line stroke on the TSL path: three's own line fragment
// reproduced over the MRT output struct. See README.md.

import {
  Discard, materialColor, materialLineDashSize, materialLineGapSize,
  materialLineScale, materialOpacity, select, varying, vec4,
} from 'three/tsl';
import {
  LineBasicNodeMaterial, LineDashedNodeMaterial, NodeMaterial, type Node,
} from 'three/webgpu';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import { srgbEncodeTsl } from '../tonemap-tsl';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { attrFloat } from '../tsl/tsl-shim';

/**
 * `vec4(diffuse, opacity)` — what three's `LineBasicMaterial` fragment
 * emits, read off the same two material properties so a consumer's
 * `material.color` / `.opacity` write reaches this graph unchanged.
 *
 * The encode branch is what the built-in path loses to the pinned output
 * colour space (`../README.md` § Output colour space): three encodes
 * linear→sRGB for the canvas and nothing for a render target, and with
 * output pinned to the working space it now encodes for neither. `uHdrTarget`
 * is 0 exactly when the target is unbound, so the stroke owns the encode
 * there and stays linear into the target — never by unpinning the output
 * space, which would double-encode every ported emitter.
 */
function strokeColour(u: SharedUniformNodes) {
  const rgb = materialColor as unknown as Node<'vec3'>;
  return select(
    u.uHdrTarget.lessThan(0.5),
    vec4(srgbEncodeTsl(rgb), materialOpacity),
    vec4(rgb, materialOpacity),
  );
}

function strokeMaterial<M extends NodeMaterial>(material: M, opacity: number): M {
  material.transparent = true;
  material.opacity = opacity;
  material.depthTest = true;
  material.depthWrite = false;
  return material;
}

/** Chrome, so both extra attachments take the blend's identity element:
 *  alpha 0 under this alpha-composited blend leaves the destination exactly
 *  as the WebGL gate's `NONE` did (`../hdr/README.md`). */
export function buildChromeLineMaterial(
  u: SharedUniformNodes, opacity: number,
): MrtEmitterMaterial & { material: LineBasicNodeMaterial } {
  const material = strokeMaterial(new LineBasicNodeMaterial(), opacity);
  material.name = 'chrome-line-tsl';
  const built = finishMrtMaterial(material, () => ({
    colour: strokeColour(u), statistic: vec4(0.0), diffuse: vec4(0.0),
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
    // three's own dash rule: the cumulative distance scaled into the
    // pattern's unit — in the VERTEX stage, as three does, so the scale
    // costs one multiply per vertex rather than per fragment — then
    // discarded across the gap half of each period. The attribute is the
    // consumer's (`../../chrome-lines/README.md`).
    const phase = varying(attrFloat('lineDistance').mul(materialLineScale));
    Discard(phase.mod(materialLineDashSize.add(materialLineGapSize))
      .greaterThan(materialLineDashSize));
    return { colour: strokeColour(u), statistic: vec4(0.0), diffuse: vec4(0.0) };
  });
  return { ...built, material };
}
