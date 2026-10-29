// The one result shape every catalogue cascade returns: the tier that answered
// and its value, or `none`, each carrying the candidates refused on the way.

/** `Values` maps each answering tier to the value it yields. Refusals ride on
 *  every variant, because a record that resolved on a lower tier is exactly the
 *  one whose refused tiers its lineage must name. */
export type CascadeResult<Values extends Record<string, unknown>, Refusal> =
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
