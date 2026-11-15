// The build's record list tagged with the phase it has reached, so each pass
// states the phase it runs in and the compiler holds the order. See README.md#record-phases.

import type { Star } from '../parse/stars-parse';

declare const phase: unique symbol;
declare const allocated: unique symbol;
declare const finalised: unique symbol;

export type RecordPhase = 'walked' | 'named' | 'promoted' | 'sorted';

/** The record list at phase `P`; the tag exists only at compile time. */
export type Records<P extends RecordPhase, S = Star> = readonly S[] & { readonly [phase]: P };

/** Records in apparent-V order: an index is a record's final address. */
export type Sorted<S = Star> = Records<'sorted', S>;

/** Each record's SID in record order, as SID allocation assigned it. */
export type AllocatedSids = readonly number[] & { readonly [allocated]: true };

/** The sorted records with what is decided once every record is final, one
 *  each per record; built only by `finalise`. */
export interface Finalised<S = Star> {
  readonly records: Sorted<S>;
  readonly sids: AllocatedSids;
  /** The name table's string, or null where the runtime composes a designation. */
  readonly displayNames: readonly (string | null)[];
  readonly [finalised]: true;
}

/** Tags `records` as having reached `_phase`. Called once per phase, by the
 *  pass that completes it; tests call it to build a fixture. */
export function enterPhase<P extends RecordPhase, S>(_phase: P, records: readonly S[]): Records<P, S> {
  return records as Records<P, S>;
}

/** Tags `sids` as SID allocation's answer. Called once, by the allocation
 *  stage; tests call it to build a fixture. */
export function allocatedSids(sids: readonly number[]): AllocatedSids {
  return sids as AllocatedSids;
}

/** Throws unless the SIDs and display names pair one-for-one with the records. */
export function finalise<S>(
  records: Sorted<S>, sids: AllocatedSids, displayNames: readonly (string | null)[],
): Finalised<S> {
  if (sids.length !== records.length || displayNames.length !== records.length) {
    throw new Error(`finalise: ${records.length} records but ${sids.length} SIDs and ${displayNames.length} display names`);
  }
  return { records, sids, displayNames } as Finalised<S>;
}
