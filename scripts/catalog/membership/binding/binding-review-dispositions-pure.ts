// The binding review dispositions' columns, closed sets and reader.

import type { Declared } from '../../../util/sources/source';
import { readTable } from '../../../util/tsv/table-pure';
import { evidenceOf } from '../../../util/tsv/cell-corrections-pure';
import { BINDING_REVIEW_KEY_COLUMNS, bindingReviewKey } from '../ledger-rows-pure';

export const BINDING_DISPOSITION_COLUMNS = [
  ...BINDING_REVIEW_KEY_COLUMNS, 'derived_source_id',
  'keep_source_id', 'basis', 'evidence',
] as const;
/** Which value a disposition settled on, for the count snapshot. */
export const BINDING_DISPOSITIONS = ['derived', 'other', 'none'] as const;
export type BindingDisposition = (typeof BINDING_DISPOSITIONS)[number];
/** Meanings: README.md#a-disposition-is-the-authority-wherever-one-keys-a-row. */
export const BINDING_DISPOSITION_BASES = [
  'tycho2_position', 'v70a_astrometry', 'simbad_dr2_object',
  'gaia_photometry', 'pair_component', 'shared_source', 'tycho2_photometry',
  'hip2_position',
] as const;
export type BindingDispositionBasis = (typeof BINDING_DISPOSITION_BASES)[number];
export type BindingDispositionRow = Record<(typeof BINDING_DISPOSITION_COLUMNS)[number], string> & {
  basis: BindingDispositionBasis;
};

export function dispositionOf(d: BindingDispositionRow): BindingDisposition {
  if (d.keep_source_id === '') return 'none';
  if (d.keep_source_id === d.derived_source_id) return 'derived';
  return 'other';
}

export function parseBindingDispositionsTsv(
  text: string,
  from: Declared,
): Map<string, BindingDispositionRow> {
  const out = new Map<string, BindingDispositionRow>();
  for (const row of readTable({ ...from, columns: BINDING_DISPOSITION_COLUMNS, exact: true }, text)) {
    const cells = row.cells();
    const key = bindingReviewKey(cells);
    for (const column of ['derived_source_id', 'keep_source_id'] as const) row.sourceId(column);
    if (out.has(key)) row.fail(`duplicate record ${key}`);
    evidenceOf(row, 'evidence', key);
    out.set(key, { ...cells, basis: row.oneOf('basis', BINDING_DISPOSITION_BASES) });
  }
  return out;
}
