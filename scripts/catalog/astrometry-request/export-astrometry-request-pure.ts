// Pure helpers for the full-catalog Gaia astrometry request export.
// See README.md.

/** Numerically sort Gaia DR3 source_id decimal strings ascending.
 *  Source_ids routinely exceed 2^53, so a lexicographic sort misorders
 *  unequal-length ids and a Number sort collides them — BigInt is the
 *  only correct comparator, matching the numeric ordering the binaries
 *  request file (`write_astrometry_request`) produces. */
export function sortSourceIdsNumeric(ids: Iterable<string>): string[] {
  return [...ids].sort((a, b) => {
    const ba = BigInt(a);
    const bb = BigInt(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  });
}
