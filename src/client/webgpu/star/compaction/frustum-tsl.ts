// TSL form of compaction-pure.ts `starQuadOffscreen`, which carries the tests.

import { abs } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { CULL_SLACK_NDC } from './compaction-pure';

/** `clip` is the star centre through the camera's view-projection; the quad
 *  reaches `halfExtentNdc` either side of it. */
export function starQuadOffscreenTsl(
  clip: Node<'vec4'>,
  halfExtentNdc: Node<'vec2'>,
): Node<'bool'> {
  return clip.w.lessThanEqual(0.0)
    .or(abs(clip.x).greaterThan(clip.w.mul(halfExtentNdc.x.add(1.0 + CULL_SLACK_NDC))))
    .or(abs(clip.y).greaterThan(clip.w.mul(halfExtentNdc.y.add(1.0 + CULL_SLACK_NDC))));
}
