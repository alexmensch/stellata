// The one result shape every catalogue cascade returns: the tier that answered
// and its value, or `none`, each carrying the candidates refused on the way.

import type { AnySourceRowRef } from '../util/sources/row-ref-pure';

/** A candidate a tier did not take, and the coded reason. A cascade adds
 *  per-instance detail (a refused value) by intersection, never by a new
 *  record shape, so one function can turn any cascade's refusals into rows. */
export interface CascadeRefusal<Tier extends string, Reason extends string> {
  readonly tier: Tier;
  readonly reason: Reason;
}

/** A refused candidate read from a source row, which it cites. */
export interface CitedRefusal<Tier extends string, Reason extends string> extends CascadeRefusal<Tier, Reason> {
  readonly ref: AnySourceRowRef;
}

type Resolution<Values, Refusal, Answer> =
  | {
      [Via in keyof Values]: {
        readonly via: Via;
        readonly value: Values[Via];
        readonly refusals: readonly Refusal[];
      } & Answer;
    }[keyof Values]
  | { readonly via: 'none'; readonly refusals: readonly Refusal[] };

/** `Values` maps each answering tier to the value it yields; a refusal may
 *  name only one of those tiers. Refusals ride on every variant, because a
 *  record that resolved on a lower tier is exactly the one whose refused tiers
 *  its lineage must name. */
export type CascadeResult<
  Values extends Record<string, unknown>,
  Refusal extends CascadeRefusal<Extract<keyof Values, string>, string>,
> = Resolution<Values, Refusal, unknown>;

/** A cascade whose answer cites every source row it rests on — none only on a
 *  curated tier, which reads no source. */
export type CitedCascadeResult<
  Values extends Record<string, unknown>,
  Refusal extends CitedRefusal<Extract<keyof Values, string>, string>,
> = Resolution<Values, Refusal, { readonly evidence: readonly AnySourceRowRef[] }>;

/** The value map for a cascade whose every tier yields the same type. */
export type UniformValues<Via extends string, Value> = Record<Exclude<Via, 'none'>, Value>;
