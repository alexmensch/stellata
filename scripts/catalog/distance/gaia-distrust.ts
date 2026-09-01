// The two ways this build refuses a Gaia value on a blended row: the 5p
// condition, and the bibcode naming Gaia's own reduction returning through a
// second-order index. Both terms of the space-motion velocity share them.

import type { GaiaAstrometryCatalogRow } from './direction-cascade';

/** Whether the row carries the full five-parameter solution. A 2p row is
 *  position-only — Gaia fitted neither parallax nor PM, which on a close pair is
 *  the blend the fit could not separate. The direction cascade's tier-1 branch,
 *  the rv cascade's Gaia tier and the PM rescue's skip rule all turn on this. */
export function gaiaHas5pSolution(row: GaiaAstrometryCatalogRow): boolean {
  return row.parallaxMas !== null;
}

/** Whether a Gaia fit stands behind this record AND declined to state five
 *  parameters — the condition both skip rules gate on. A record with no Gaia
 *  row at all is NOT 2p: there is no blend to distrust, so a Gaia bibcode on
 *  it is an ordinary citation rather than the withheld fit returning. */
export function gaiaRowIs2p(row: GaiaAstrometryCatalogRow | null): boolean {
  return row !== null && !gaiaHas5pSolution(row);
}

// Gaia's own catalogue releases, in BOTH forms a second-order index cites them
// by: the VizieR table — I/345 (DR2), I/350 (EDR3), I/355 (DR3) — and the
// release paper the same data was published as. A DR4 release adds one of each.
//
// Both forms are required because the two indices disagree about which to use:
// SIMBAD cites the VizieR table, CNS5 the paper (45 of its parallaxes and 45 of
// its motions read `2018A&A...616A...1G`), so a set holding only one form lets
// the other walk a withdrawn Gaia value straight back into a cascade.
//
// DR1/TGAS (`2016A&A...595A...1G`, `2016A&A...595A...2G`) is deliberately
// absent. Its astrometry is a JOINT solution over Gaia and the
// Hipparcos/Tycho-2 positions, not a Gaia-only reduction, so a value citing it
// is not the same fit returning — it is a different measurement with a ~24-yr
// baseline this build has no other route to.
const GAIA_CATALOGUE_BIBCODES: ReadonlySet<string> = new Set([
  '2018yCat.1345....0G', '2018A&A...616A...1G',
  '2020yCat.1350....0G', '2021A&A...649A...1G',
  '2022yCat.1355....0G', '2023A&A...674A...1G',
]);

/** Whether a bibcode names a Gaia catalogue release rather than the
 *  literature. The rv tier's and the PM rescue's skip rules turn on it; the
 *  SIMBAD tiers pin their split by it. Takes a bibcode, never an absence —
 *  both pulls drop an uncited value whole (`../cited-proper-motion.ts`), so a
 *  null here could only be a citation that went missing after the parse, and
 *  reading it as "not Gaia" would silently admit it. */
export function isGaiaCatalogueBibcode(bibcode: string): boolean {
  return GAIA_CATALOGUE_BIBCODES.has(bibcode);
}

/** Whether a bibcode names the Hipparcos re-reduction — van Leeuwen 2007, the
 *  publication the HIP2 tier itself reads.
 *
 *  This exists because the skip rule generalises past Gaia. A courier serving a
 *  value attributed to the very publication a first-order tier above it already
 *  weighed and refused is laundering that refusal, whatever the publication is.
 *  For a HIP-bearing record SIMBAD's parallax usually IS van Leeuwen's, so
 *  without this the parallax cascade's precision gate refuses a value and then
 *  re-admits the identical number one tier down, stripped of the error bar the
 *  refusal was based on — measured at 574 records, matching to the digit. */
export function isHipparcos2Bibcode(bibcode: string | null): boolean {
  return bibcode === '2007A&A...474..653V';
}
