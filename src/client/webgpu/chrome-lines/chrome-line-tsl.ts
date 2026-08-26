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

/** The encode branch: README.md § The encode the built-in path lost. */
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
    const phase = varying(attrFloat('lineDistance').mul(materialLineScale));
    Discard(phase.mod(materialLineDashSize.add(materialLineGapSize))
      .greaterThan(materialLineDashSize));
    return { colour: strokeColour(u), statistic: vec4(0.0), diffuse: vec4(0.0) };
  });
  return { ...built, material };
}
