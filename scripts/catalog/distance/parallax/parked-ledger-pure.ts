// The record-parity dropped list (/docs/catalog-driver.md#61-record-parity): its closed reason enum and the
// identifier key the parity gate matches it on.
// See README.md#why-the-residual-drops-rather-than-degrading.

import type { RecordIdentifiers } from '../../lineage/identity-pure';

/** The closed enum record parity (/docs/catalog-driver.md#61-record-parity) requires, for this membership event.
 *  `refused_no_defensible_parallax` is a row whose only measurement a skip rule
 *  refused; `no_parallax_published` is a row nothing ever measured. The two
 *  have different futures — the first reinstates when Gaia DR4 fits the blend,
 *  the second needs someone to measure the star. `no_v_magnitude` is a row
 *  placed but unlit: no V tier reaches it, and a record needs both.
 *  `no_position` is the mirror of that last one — lit, and given a distance by
 *  a bound sibling, but no direction tier states where on the sky it is, so
 *  there is nothing to multiply the distance by. */
export const PARKED_REASONS = [
  'refused_no_defensible_parallax',
  'no_parallax_published',
  'no_v_magnitude',
  'no_position',
] as const;

export type ParkedReason = (typeof PARKED_REASONS)[number];

/** One ledger row: a manifest row the walk could not ship, by its five
 *  identifier cells. Records leave the catalogue entirely, so nothing else in
 *  the build records that they existed. */
export interface ParkedLedgerEntry extends RecordIdentifiers {
  reason: ParkedReason;
}

export interface ParkedRecord extends ParkedLedgerEntry {
  /** Build-time only — no ledger column carries it. Every parallax a skip rule
   *  refused on this row, mas, which is what companion promotion needs to tell a
   *  pair row re-serving the refusal from one merely sharing the blend's id
   *  (`../../companions/README.md#refused-parallax-refusal`). Empty on the
   *  three reasons that refused nothing. */
  refusedPlxMas: readonly number[];
  /** Build-time only: the record's lineage origin key, which a promotion row
   *  that would re-serve the refusal cites. */
  originKey: string;
}

