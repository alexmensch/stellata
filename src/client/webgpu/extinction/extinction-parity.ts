// The kernel's parity instrument: the same TSL march as a fragment pass
// into a star-indexed float target, bit-compared against the storage
// buffer the kernel wrote. README.md § The prepass kernel.

import {
  FloatType, NearestFilter, NoBlending, NodeMaterial, QuadMesh, RedFormat,
  RenderTarget, type StorageBufferAttribute, type WebGPURenderer,
} from 'three/webgpu';
import { Fn, ivec2, screenCoordinate, vec4, type storage } from 'three/tsl';
import {
  AV_TEX_WIDTH, avTexHeight,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import {
  compareAvBuffers, type AvParityReport,
} from '../../star-pipeline/extinction/av-parity-pure';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { dustRaymarchAvTsl, type DustTextureNode } from './dust-raymarch-tsl';

export interface ReferenceMarchInputs {
  renderer: WebGPURenderer;
  nodes: SharedUniformNodes;
  dust: DustTextureNode;
  /** The kernel's own inputs, so the only variable is the shader stage. */
  positions: ReturnType<typeof storage<'vec4'>>;
  absCameraPos: Parameters<typeof dustRaymarchAvTsl>[2];
  av: StorageBufferAttribute;
  count: number;
}

/**
 * Marches every star once more as a fragment — the 1024-wide star-indexed
 * layout the fragment prepass drew — reads both results back and compares
 * bits. Allocates the target for the call only. Texels past `count` read
 * the buffer's clamped last slot and are never compared.
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
    const starAbs = inputs.positions.element(px.y.mul(AV_TEX_WIDTH).add(px.x)).xyz;
    return vec4(
      dustRaymarchAvTsl(inputs.nodes, inputs.dust, inputs.absCameraPos, starAbs), 0, 0, 1);
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
    return compareAvBuffers(
      new Float32Array(computed), texels, count, texels.length / (AV_TEX_WIDTH * height));
  } finally {
    material.dispose();
    rt.dispose();
  }
}
