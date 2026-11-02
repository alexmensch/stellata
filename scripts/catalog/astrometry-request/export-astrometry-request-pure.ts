// Pure helpers for the full-catalog Gaia astrometry request export.
// See README.md.

import { compareSourceIds } from '../../util/tsv/table-pure';

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

export function parseSourceIdRequest(text: string): Set<string> {
  const [header, ...ids] = text.trimEnd().split('\n');
  if (header !== REQUEST_HEADER) {
    throw new Error(`source_id request header is ${JSON.stringify(header)}, expected ${REQUEST_HEADER}`);
  }
  return new Set(ids);
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
