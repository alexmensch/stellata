// The build's record list tagged with the phase it has reached, so each pass
// states the phase it runs in and the compiler holds the order. See README.md#record-phases.

import type { Star } from '../parse/stars-parse';

declare const phase: unique symbol;

export type RecordPhase = 'walked' | 'named' | 'promoted' | 'sorted';

/** The record list at phase `P`; the tag exists only at compile time. */
export type Records<P extends RecordPhase, S = Star> = readonly S[] & { readonly [phase]: P };

/** Records in apparent-V order: an index is a record's final address. */
export type Sorted<S = Star> = Records<'sorted', S>;

/** The sorted records with what is decided once every record is final, each per record. */
export interface Finalised<S = Star> {
  readonly records: Sorted<S>;
  readonly sids: readonly number[];
  /** The name table's string, or null where the runtime composes a designation. */
  readonly displayNames: readonly (string | null)[];
}

/** Tags `records` as having reached `_phase`. Called once per phase, by the
 *  pass that completes it; tests call it to build a fixture. */
export function enterPhase<P extends RecordPhase, S>(_phase: P, records: readonly S[]): Records<P, S> {
  return records as Records<P, S>;
}
