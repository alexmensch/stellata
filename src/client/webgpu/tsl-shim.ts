// Typed patches over @types/three's TSL surface. Only compile-verified
// gaps live here — delete each entry when upstream types catch up
// (README.md § TSL typing shim).

import { attribute, step as stepFloatPinned } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { Vector2, Vector3, Vector4 } from 'three';
import type { NodeObject } from 'three/src/nodes/tsl/TSLCore.js';

/** The swizzle/operator wrapper type the TSL runtime hands out. Under
 *  the historical runtime name — 'three/tsl' exports neither. */
export type ShaderNodeObject<T> = NodeObject<T>;

// attribute()'s TNodeType generic infers `string` from a literal second
// argument, losing the whole swizzle/operator surface; the explicit
// generic pins it.
export const attrFloat = (name: string) => attribute<'float'>(name, 'float');
export const attrVec2 = (name: string) => attribute<'vec2'>(name, 'vec2');
export const attrVec3 = (name: string) => attribute<'vec3'>(name, 'vec3');
export const attrVec4 = (name: string) => attribute<'vec4'>(name, 'vec4');

type NF = Node<'float'> | number;
type N2 = Node<'vec2'> | Vector2;
type N3 = Node<'vec3'> | Vector3;
type N4 = Node<'vec4'> | Vector4;

// step() is float-pinned upstream while the runtime (and WGSL step) is
// vec-capable — the widening 0.185.4 already gave pow/mix.
interface StepVec {
  (edge: NF, x: NF): Node<'float'>;
  (edge: N2 | NF, x: N2): Node<'vec2'>;
  (edge: N3 | NF, x: N3): Node<'vec3'>;
  (edge: N4 | NF, x: N4): Node<'vec4'>;
}
export const step = stepFloatPinned as unknown as StepVec;
