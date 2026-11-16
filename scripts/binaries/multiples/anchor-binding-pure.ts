// Whether each system's anchor is a letter companion promotion can anchor on, read off the pairs Stage 6 emitted. See README.md#the-shape-of-a-result.

import { componentKey } from '../component-tokens-pure';
import type { DecomposedPair, ResolvedComponent } from '../resolve/components-pure';
import { groupBy } from '../../util/map-buckets-pure';
import { firstByPrimary, mostCanonical, type AnchorChoice, type AnchorOffsets } from './anchor-offsets-pure';

export const ANCHOR_BINDINGS = [
  'bound', 're_basable', 'promotion_anchor_unreached', 'no_bound_primary', 'nothing_bound', 'unplaced',
] as const;
export type AnchorBindingKind = (typeof ANCHOR_BINDINGS)[number];

export type AnchorBinding =
  | { readonly kind: 'bound' | 'no_bound_primary' | 'nothing_bound' | 'unplaced' }
  | { readonly kind: 're_basable' | 'promotion_anchor_unreached'; readonly boundPrimary: DecomposedPair };

export interface SystemAnchor {
  readonly choice: AnchorChoice;
  readonly binding: AnchorBinding;
}

const bound = (c: ResolvedComponent): boolean => c.gaia !== null || c.hip !== null;

function bindingOf(wdsId: string, choice: AnchorChoice, emitted: readonly DecomposedPair[], offsets: AnchorOffsets['offsets']): AnchorBinding {
  const boundPrimaries = firstByPrimary(emitted.filter((p) => bound(p.primary)));
  if (boundPrimaries.has(choice.pair.primary.component)) return { kind: 'bound' };
  if (boundPrimaries.size > 0) {
    const boundPrimary = boundPrimaries.get(mostCanonical(boundPrimaries.keys()))!;
    const reached = offsets.has(componentKey(wdsId, boundPrimary.primary.component));
    return { kind: reached ? 're_basable' : 'promotion_anchor_unreached', boundPrimary };
  }
  return { kind: emitted.some((p) => bound(p.secondary)) ? 'no_bound_primary' : 'nothing_bound' };
}

/** Each system's anchor choice beside its binding, over the pairs Stage 6 wrote rows for. */
export function anchorBindings(anchors: AnchorOffsets, emitted: readonly DecomposedPair[]): ReadonlyMap<string, SystemAnchor> {
  const emittedBySystem = groupBy(emitted, (p) => p.pair.wdsId);
  const out = new Map<string, SystemAnchor>();
  for (const [wdsId, choice] of anchors.choices) {
    const placed = emittedBySystem.get(wdsId);
    out.set(wdsId, { choice, binding: placed === undefined ? { kind: 'unplaced' } : bindingOf(wdsId, choice, placed, anchors.offsets) });
  }
  return out;
}
