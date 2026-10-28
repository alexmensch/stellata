// Pure helpers for the full-catalog Gaia astrometry request export.
// See README.md.

import { compareSourceIds } from '../../util/tsv/table-pure';

/** The numeric order the binaries request file (`write_astrometry_request`)
 *  produces too. */
export function sortSourceIdsNumeric(ids: Iterable<string>): string[] {
  return [...ids].sort(compareSourceIds);
}
