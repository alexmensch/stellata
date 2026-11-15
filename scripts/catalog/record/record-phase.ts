// The build's record list tagged with the phase it has reached, so each pass
// states the phase it runs in and the compiler holds the order. See README.md#record-phases.

import type { NamedStar, Star, WalkedStar } from '../parse/stars-parse';

declare const phase: unique symbol;
declare const allocated: unique symbol;
declare const finalised: unique symbol;

export type RecordPhase = 'walked' | 'named' | 'promoted' | 'sorted';

/** The fields a record carries on entering each phase; later steps attach the rest (README.md#field-groups). */
interface RecordAt {
  walked: WalkedStar;
  named: NamedStar;
  promoted: NamedStar;
  sorted: NamedStar;
}

export type Records<P extends RecordPhase, S = RecordAt[P]> = readonly S[] & { readonly [phase]: P };

export type Sorted<S = RecordAt['sorted']> = Records<'sorted', S>;

export type Unsorted<S = WalkedStar> = Records<Exclude<RecordPhase, 'sorted'>, S>;

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

/** README.md#field-groups. */
export function attach<P extends RecordPhase, S extends object, F extends object>(
  records: Records<P, S>, fieldsOf: (record: S, index: number) => F,
): Records<P, S & F> {
  records.forEach((record, i) => Object.assign(record, fieldsOf(record, i)));
  return records as unknown as Records<P, S & F>;
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
