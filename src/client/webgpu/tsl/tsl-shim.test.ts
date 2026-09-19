// Runtime half of the shim's coverage; the compile half IS this file
// typechecking — the swizzles and vec-typed step below fail tsc if the
// shim regresses to the upstream gaps.
import { describe, expect, it } from 'vitest';
import { Fn, compute as computeTsl, mix as mixTsl, step as stepTsl, vec3 } from 'three/tsl';
import { IndirectStorageBufferAttribute, type Node } from 'three/webgpu';
import { attrFloat, attrVec4, computeIndirect, mix, step } from './tsl-shim';

describe('tsl-shim', () => {
  it('attr helpers pin the node type the generic otherwise loses', () => {
    expect(attrVec4('iPosDist').nodeType).toBe('vec4');
    expect(attrFloat('iDistSol').nodeType).toBe('float');
    const swizzled: Node<'vec3'> = attrVec4('iPosDist').xyz;
    expect(swizzled).toBeDefined();
  });

  it('step is the tsl runtime function, retyped only', () => {
    expect(step).toBe(stepTsl);
    const v: Node<'vec3'> = step(vec3(0.5), vec3(0.25, 0.75, 0.5));
    expect(v).toBeDefined();
  });

  it('mix is the tsl runtime function, retyped only (vector t)', () => {
    expect(mix).toBe(mixTsl);
    const v: Node<'vec3'> = mix(vec3(0.0), vec3(1.0), vec3(0.0, 0.5, 1.0));
    expect(v).toBeDefined();
  });

  // The runtime files a non-numeric count under dispatchSize and leaves
  // count null, which is what keeps three's early return out of the kernel.
  it('computeIndirect is the tsl runtime compute, dispatching at the attribute', () => {
    expect(computeIndirect).toBe(computeTsl);
    const dispatch = new IndirectStorageBufferAttribute(Uint32Array.from([0, 1, 1]), 1);
    const kernel = computeIndirect(Fn(() => {})(), dispatch, [64]);
    expect(kernel.dispatchSize).toBe(dispatch);
    expect(kernel.count).toBeNull();
    expect(kernel.workgroupSize).toEqual([64, 1, 1]);
  });
});
