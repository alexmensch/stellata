// Parser and per-record lookup for data/simbad/simbad_values.tsv — the
// bibcoded bottom tier of the § 5 value cascades. See README.md § The
// SIMBAD values index.

import { dataRows, nonEmpty, parseFloatOrNull, parseIntOrNull } from './parse/corpus-tsv';
import {
  emptySimbadNamespaceIndex,
  indexSimbadRow,
  walkSimbadNamespaces,
  type SimbadNamespaceIndex,
  type SimbadRecordKeys,
} from './catalog-pure';

const FILE_LABEL = 'data/simbad/simbad_values.tsv';
const REFRESH_HINT = 'Re-run `pnpm run refresh:simbad-values`.';

const COLUMNS = [
  'rvz_radvel', 'rvz_type', 'rvz_bibcode',
  'hip', 'source_id', 'tyc', 'gj',
] as const;

/** One SIMBAD row's radial velocity, with the bibcode that is its actual
 *  source. */
export interface SimbadRadialVelocity {
  kmS: number;
  bibcode: string;
}

export interface SimbadValueRow {
  rv: SimbadRadialVelocity | null;
}

export interface SimbadValueIndex extends SimbadNamespaceIndex<SimbadValueRow> {
  /** Data rows read, counted at the walk rather than derived from the maps:
   *  the pull also enumerates by SIMBAD oid, so a row carrying none of the
   *  four ids is joinable by nothing and must still be counted. */
  rowCount: number;
}

export function emptySimbadValueIndex(): SimbadValueIndex {
  return { ...emptySimbadNamespaceIndex<SimbadValueRow>(), rowCount: 0 };
}


/** SIMBAD's `rvz_radvel` is a radial velocity only where `rvz_type` reads
 *  `v`. A `z` row carries a redshift-derived quantity, which on a catalogue
 *  bounded at 50 kpc is never a stellar line-of-sight velocity — EGGR 252
 *  reads 243,879 km/s. An unbibcoded value cannot arrive (the pull drops the
 *  whole quantity at write time), so the bibcode check here guards a
 *  re-pulled file rather than this one. */
function parseRv(cells: string[], idx: Record<string, number>): SimbadRadialVelocity | null {
  if (nonEmpty(cells[idx.rvz_type]) !== 'v') return null;
  const kmS = parseFloatOrNull(cells[idx.rvz_radvel]);
  const bibcode = nonEmpty(cells[idx.rvz_bibcode]);
  if (kmS === null || bibcode === null) return null;
  return { kmS, bibcode };
}

/** Index the values pull by every identifier namespace it keyed on. No key
 *  in any namespace collides in the committed file, so a duplicate is an
 *  upstream schema change and throws rather than silently overwriting a
 *  binding the cascade would then read off the wrong star. */
export function parseSimbadValuesTsv(text: string): SimbadValueIndex {
  const index = emptySimbadValueIndex();
  for (const { cells, idx } of dataRows(text, COLUMNS, FILE_LABEL, REFRESH_HINT)) {
    const keys: SimbadRecordKeys = {
      sourceId: nonEmpty(cells[idx.source_id]),
      hip: parseIntOrNull(cells[idx.hip]),
      tyc: nonEmpty(cells[idx.tyc]),
      gl: nonEmpty(cells[idx.gj]),
    };
    indexSimbadRow(index, keys, { rv: parseRv(cells, idx) }, (namespace, key) => {
      throw new Error(
        `${FILE_LABEL} has two rows keyed ${namespace}=${key}. ${REFRESH_HINT}`,
      );
    });
    index.rowCount++;
  }
  return index;
}

/** The record's SIMBAD row, resolved source_id → HIP → TYC → GJ — the same
 *  ladder `resolve_spine_keys` composed the request with, in the same order,
 *  so a widened row is read back under the namespace that bound it. A row
 *  reached by anything but source_id is one the Gaia namespace could not
 *  reach; the pull already dropped the widened bindings SIMBAD's own Gaia
 *  cross-IDs contradict (`scripts/refresh/simbad/README.md` § The widening
 *  carries its own corroboration rule), so what arrives here is adjudicated.
 *  Its `source_id` cell may name a DIFFERENT source from the record's — that
 *  is the DR2/DR3 case, and it is inert because no record asks for it. */
export function lookupSimbadValues(
  index: SimbadValueIndex,
  keys: SimbadRecordKeys,
): SimbadValueRow | null {
  return walkSimbadNamespaces(index, keys, (row) => row)?.value ?? null;
}
