// The single-output ↔ MRT-struct swap every ported emitter carries. See
// README.md § The gate becomes the output struct.

import { Fn, outputStruct, struct } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';
import type { MrtOutputLayer } from './hdr-pipeline-webgpu';

const EMITTER_OUTPUTS = /* @__PURE__ */ struct({
  colour: 'vec4', statistic: 'vec4', diffuse: 'vec4',
}, 'StellataEmitterOutputs');

/** The three attachments one emitter fragment writes. A slot the WebGL
 *  gate would have masked off writes `vec4(0)`, which leaves the
 *  destination untouched exactly as `NONE` did — but only because every
 *  blend that reaches an MRT target treats 0 as its identity. Chart
 *  mode's `MultiplyBlending` does NOT (its identity is 1), and it is safe
 *  solely because chart unbinds the target, so a material in the struct
 *  graph never draws under it (`hdr-pipeline-webgpu.ts` `wantsTarget`).
 *  A new blend on an MRT path has to be checked against that. */
export interface EmitterOutputs {
  colour: Node<'vec4'>;
  statistic: Node<'vec4'>;
  diffuse: Node<'vec4'>;
}

export interface MrtEmitterMaterial extends MrtOutputLayer {
  readonly material: NodeMaterial;
}

/**
 * Give a material both fragment graphs and the swap between them.
 *
 * `build` is invoked **once per graph** so neither shares a node with the
 * other, and the single-output graph is installed first — a material must
 * never reach a one-attachment target carrying a three-member struct,
 * which fails pipeline creation.
 *
 * Both graphs run their body inside an `Fn`, which is what gives `If` /
 * `Loop` / a `.toVar()` assignment somewhere to attach: TSL's
 * control-flow builders write into the enclosing function's stack and
 * throw with none. The MRT one hands its three members back through a
 * struct return rather than building `outputStruct` in there, because
 * three tests `fragmentNode.isOutputStructNode` on the TOP-LEVEL node and
 * silently converts anything else to a single vec4.
 */
export function finishMrtMaterial(
  material: NodeMaterial,
  build: () => EmitterOutputs,
): MrtEmitterMaterial {
  const single = Fn(() => build().colour)();
  const members = Fn(() => {
    const o = build();
    return EMITTER_OUTPUTS(o.colour, o.statistic, o.diffuse);
  })();
  const mrt = outputStruct(
    members.get('colour'), members.get('statistic'), members.get('diffuse'));
  let mrtOn = false;
  material.fragmentNode = single;
  return {
    material,
    setMrtOutputs(on: boolean) {
      if (on === mrtOn) return;
      mrtOn = on;
      material.fragmentNode = on ? mrt : single;
      material.needsUpdate = true;
    },
  };
}
