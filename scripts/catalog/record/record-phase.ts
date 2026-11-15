// The build's record list tagged with the phase it has reached, so each pass
// states the phase it runs in and the compiler holds the order. See README.md#record-phases.

import type { Star } from '../parse/stars-parse';

declare const phase: unique symbol;
declare const allocated: unique symbol;
declare const finalised: unique symbol;

export type RecordPhase = 'walked' | 'named' | 'promoted' | 'sorted';

export type Records<P extends RecordPhase, S = Star> = readonly S[] & { readonly [phase]: P };

export type Sorted<S = Star> = Records<'sorted', S>;

export type Unsorted<S = Star> = Records<Exclude<RecordPhase, 'sorted'>, S>;

export type AllocatedSids = readonly number[] & { readonly [allocated]: true };

export interface Finalised<S = Star> {
  readonly records: Sorted<S>;
  readonly sids: AllocatedSids;
  readonly displayNames: readonly (string | null)[];
  readonly [finalised]: true;
}

/** Called once per phase, by the pass that completes it; tests build fixtures with it. */
export function enterPhase<P extends RecordPhase, S>(_phase: P, records: readonly S[]): Records<P, S> {
  return records as Records<P, S>;
}

/** Called once, by the allocation stage; tests build fixtures with it. */
export function allocatedSids(sids: readonly number[]): AllocatedSids {
  return sids as AllocatedSids;
}

export function finalise<S>(
  records: Sorted<S>, sids: AllocatedSids, displayNames: readonly (string | null)[],
): Finalised<S> {
  if (sids.length !== records.length || displayNames.length !== records.length) {
    throw new Error(`finalise: ${records.length} records but ${sids.length} SIDs and ${displayNames.length} display names`);
  }
  return { records, sids, displayNames } as Finalised<S>;
}
