// The record-parity dropped list (/docs/catalog-driver.md#61-record-parity): its closed reason enum and the
// identifier key the parity gate matches it on.
// See README.md#why-the-residual-drops-rather-than-degrading.

import { nullableCell } from '../../../util/tsv/artifact-pure';
import { intCell, sourceIdCell, textCell } from '../../../util/tsv/table-pure';

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

/** The build-counts key each reason is pinned under. The ledger file
 *  enumerates the rows; these pin how many, so a reason that starts or stops
 *  firing fails the build rather than only moving a committed TSV. */
export const PARKED_COUNT_KEY = {
  refused_no_defensible_parallax: 'parkedRefusedNoDefensibleParallax',
  no_parallax_published: 'parkedNoParallaxPublished',
  no_v_magnitude: 'parkedNoVMagnitude',
  no_position: 'parkedNoPosition',
} as const satisfies Record<ParkedReason, string>;

/** One ledger row: a manifest row the walk could not ship, by its five
 *  identifier cells. Records leave the catalogue entirely, so nothing else in
 *  the build records that they existed. */
export interface ParkedLedgerEntry {
  tyc: string | null;
  hip: number | null;
  hd: number | null;
  gl: string | null;
  gaiaSourceId: string | null;
  reason: ParkedReason;
}

/** The five identifier cells a park is keyed on, without its reason. */
export type ParkedIdentifiers = Omit<ParkedLedgerEntry, 'reason'>;

/** The five cells' text, as the ledger and a placement park row both write them. */
export function parkedLedgerCells(ids: ParkedIdentifiers) {
  return {
    tyc: nullableCell(ids.tyc),
    hip: nullableCell(ids.hip),
    hd: nullableCell(ids.hd),
    gl: nullableCell(ids.gl),
    gaia_source_id: nullableCell(ids.gaiaSourceId),
  };
}

export type ParkedLedgerCells = ReturnType<typeof parkedLedgerCells>;

/** Throws on a malformed cell, as the ledger's own read does. */
export function parkedIdentifiersOf(cells: ParkedLedgerCells): ParkedIdentifiers {
  return {
    tyc: textCell(cells.tyc),
    hip: intCell(cells.hip),
    hd: intCell(cells.hd),
    gl: textCell(cells.gl),
    gaiaSourceId: sourceIdCell(cells.gaia_source_id),
  };
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

/** The five identifier cells, joined — the manifest carries all of them under
 *  the same names, so the parity gate matches ledger row to manifest row on the
 *  whole tuple rather than guessing which id is the one that identifies. */
export function parkedRecordKey(cells: {
  tyc: string; hip: string; hd: string; gl: string; gaia_source_id: string;
}): string {
  return [cells.tyc, cells.hip, cells.hd, cells.gl, cells.gaia_source_id].join('\t');
}
