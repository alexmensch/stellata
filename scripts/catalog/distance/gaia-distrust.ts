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

// Gaia's own catalogue releases as a second-order index cites them — VizieR
// I/345 (DR2), I/350 (EDR3), I/355 (DR3). A DR4 release adds one entry here.
const GAIA_CATALOGUE_BIBCODES: ReadonlySet<string> = new Set([
  '2018yCat.1345....0G',
  '2020yCat.1350....0G',
  '2022yCat.1355....0G',
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
