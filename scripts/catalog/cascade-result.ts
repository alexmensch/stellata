// The one result shape every catalogue cascade returns: the tier that answered
// and its value, or `none`, each carrying the candidates refused on the way.

/** A candidate a tier did not take, and the coded reason. A cascade adds
 *  per-instance detail (a refused value) by intersection, never by a new
 *  record shape, so one function can turn any cascade's refusals into rows. */
export interface CascadeRefusal<Tier extends string, Reason extends string> {
  readonly tier: Tier;
  readonly reason: Reason;
}

/** `Values` maps each answering tier to the value it yields; a refusal may
 *  name only one of those tiers. Refusals ride on every variant, because a
 *  record that resolved on a lower tier is exactly the one whose refused tiers
 *  its lineage must name. */
export type CascadeResult<
  Values extends Record<string, unknown>,
  Refusal extends CascadeRefusal<Extract<keyof Values, string>, string>,
> =
  | {
      [Via in keyof Values]: {
        readonly via: Via;
        readonly value: Values[Via];
        readonly refusals: readonly Refusal[];
      };
    }[keyof Values]
  | { readonly via: 'none'; readonly refusals: readonly Refusal[] };

/** The value map for a cascade whose every tier yields the same type. */
export type UniformValues<Via extends string, Value> = Record<Exclude<Via, 'none'>, Value>;
