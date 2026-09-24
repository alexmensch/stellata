// The kernel's parity instrument: the same TSL march as a fragment pass
// into a star-indexed float target, bit-compared against the storage
// buffer the kernel wrote. README.md#the-prepass-kernel.

import {
  FloatType, NearestFilter, NoBlending, NodeMaterial, QuadMesh, RedFormat,
  RenderTarget, type Node, type StorageBufferAttribute, type WebGPURenderer,
} from 'three/webgpu';
import { Fn, If, float, int, ivec2, screenCoordinate, vec4, type storage } from 'three/tsl';
import {
  AV_TEX_WIDTH, avTexHeight,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import {
  compareAvBuffers, type AvParityReport,
} from '../../star-pipeline/extinction/av-parity-pure';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { scatterByOrder } from './dispatch-order/dispatch-order-pure';
import { dustRaymarchAvTsl, type DustTextureNode } from './dust-raymarch-tsl';

/** Whether the cache fills this star at all, given its absolute position
 *  — the kernel's own gate, so the reference cannot skip a different set
 *  (`extinction-prepass-webgpu.ts`). */
export type StarCacheGate = (self: Node<'int'>, starAbs: Node<'vec3'>) => Node<'bool'>;

export interface ReferenceMarchInputs {
  renderer: WebGPURenderer;
  nodes: SharedUniformNodes;
  dust: DustTextureNode;
  /** The kernel's own inputs, so the only variable is the shader stage. */
  positions: ReturnType<typeof storage<'vec4'>>;
  /** The kernel's dispatch slot → star map, which the positions above are
   *  already in. Texel `i` therefore carries star `order[i]`. */
  order: Uint32Array;
  /** The same map on the GPU: the gate below keys on the star, not the
   *  slot the fragment is drawing. */
  orderNode: ReturnType<typeof storage<'uint'>>;
  gate: StarCacheGate | null;
  absCameraPos: Parameters<typeof dustRaymarchAvTsl>[2];
  av: StorageBufferAttribute;
  count: number;
}

/**
 * Marches every star once more as a fragment — the 1024-wide layout the
 * fragment prepass drew, over the kernel's dispatch slots — puts the result
 * back into star order, reads both back and compares bits. Allocates the
 * target for the call only. Texels past `count` read the buffer's clamped
 * last slot and are never compared.
 */
export async function runReferenceMarch(inputs: ReferenceMarchInputs): Promise<AvParityReport> {
  const { renderer, count } = inputs;
  const height = avTexHeight(count);
  const rt = new RenderTarget(AV_TEX_WIDTH, height, {
    format: RedFormat,
    type: FloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  const material = new NodeMaterial();
  material.name = 'extinction-reference-march';
  material.fragmentNode = Fn(() => {
    const px = ivec2(screenCoordinate);
    const slot = px.y.mul(AV_TEX_WIDTH).add(px.x);
    const starAbs = inputs.positions.element(slot).xyz;
    const march = () => dustRaymarchAvTsl(
      inputs.nodes, inputs.dust, inputs.absCameraPos, starAbs);
    if (inputs.gate === null) return vec4(march(), 0, 0, 1);
    const av = float(0.0).toVar();
    If(inputs.gate(int(inputs.orderNode.element(slot)), starAbs), () => {
      av.assign(march());
    });
    return vec4(av, 0, 0, 1);
  })();
  material.depthTest = false;
  material.depthWrite = false;
  material.blending = NoBlending;
  const quad = new QuadMesh(material);
  try {
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    renderer.setRenderTarget(null);
    const [reference, computed] = await Promise.all([
      renderer.readRenderTargetPixelsAsync(rt, 0, 0, AV_TEX_WIDTH, height),
      renderer.getArrayBufferAsync(inputs.av),
    ]);
    const texels = reference as Float32Array;
    const starIndexed = scatterByOrder(
      texels, inputs.order, count, texels.length / (AV_TEX_WIDTH * height));
    return compareAvBuffers(new Float32Array(computed), starIndexed, count);
  } finally {
    material.dispose();
    rt.dispose();
  }
}
