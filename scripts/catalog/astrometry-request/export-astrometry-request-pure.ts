// Pure helpers for the full-catalog Gaia astrometry request export.
// See README.md.

import type { Declared } from '../../util/sources/source';
import { compareSourceIds, readTable } from '../../util/tsv/table-pure';

/** The numeric order the binaries request file (`write_astrometry_request`)
 *  produces too. */
export function sortSourceIdsNumeric(ids: Iterable<string>): string[] {
  return [...ids].sort(compareSourceIds);
}

const REQUEST_HEADER = 'gaia_source_id';

/** A source_id request file: the header line, then one id per line in
 *  numeric order. */
export function serialiseSourceIdRequest(ids: Iterable<string>): string {
  return `${REQUEST_HEADER}\n${sortSourceIdsNumeric(ids).map((id) => `${id}\n`).join('')}`;
}

/** The ids of a source_id request file, in file order, naming the file and line of a bad one. */
export function readSourceIdRequest(text: string, from: Declared): bigint[] {
  return [...readTable({ ...from, columns: [REQUEST_HEADER] }, text)].map((row) => BigInt(row.requiredSourceId(REQUEST_HEADER)));
}

/** The primaries rows whose bound source the request leaves out — the
 *  coverage README.md#the-record-builds-sources-are-covered-by-measurement
 *  holds at zero. */
export function unrequestedBindings<R extends { term: string; gaiaSourceId: string | null }>(
  rows: readonly R[],
  requested: ReadonlySet<string>,
): R[] {
  return rows.filter((r) => r.term === 'primaries' && r.gaiaSourceId !== null && !requested.has(r.gaiaSourceId));
}
