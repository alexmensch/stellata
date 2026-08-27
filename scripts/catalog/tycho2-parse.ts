// Parser and per-record lookup for data/tycho2/{tycho2_main,tycho2_suppl1}.tsv
// — the first-order tier under HIP2 in the § 5 direction, PM and V cascades.
// See README.md § The Tycho-2 index.

import { dataRows, nonEmpty, parseFloatOrNull } from './parse/corpus-tsv';

const MAIN_LABEL = 'data/tycho2/tycho2_main.tsv';
const SUPPL1_LABEL = 'data/tycho2/tycho2_suppl1.tsv';
const REFRESH_HINT = 'Re-run `pnpm run refresh:tycho2`.';

const MAIN_COLUMNS = [
  'tyc1', 'tyc2', 'tyc3', 'pflag',
  'ra_mdeg', 'de_mdeg', 'ep_ra', 'ep_de', 'pm_ra', 'pm_de',
  'ra_icrs', 'de_icrs', 'bt_mag', 'vt_mag',
] as const;

const SUPPL1_COLUMNS = [
  'tyc1', 'tyc2', 'tyc3', 'flag',
  'ra_icrs', 'de_icrs', 'pm_ra', 'pm_de', 'bt_mag', 'vt_mag',
] as const;

/** The epoch a `ra_icrs` / `de_icrs` cell is stated at. Tycho-2 publishes it as
 *  its own propagation of the mean solution to J2000, so a row falling back to
 *  it advances from there rather than from a mean epoch it has none of. */
export const TYCHO2_ICRS_EPOCH = 2000.0;

/** One Tycho-2 entry, with the position choice already made.
 *
 *  `raDeg` / `decDeg` is the position to propagate FROM and `epochRa` /
 *  `epochDec` are its epochs — separately, because a mean solution's two
 *  coordinates are observed over different intervals (a row can read `ep_ra`
 *  1991.07 against `ep_de` 1991.00). `pmRaMasyr` is μ_α*, cos δ already
 *  applied; never divide by cos δ again. */
export interface Tycho2Row {
  raDeg: number;
  decDeg: number;
  epochRa: number;
  epochDec: number;
  pmRaMasyr: number | null;
  pmDecMasyr: number | null;
  btMag: number | null;
  vtMag: number | null;
  /** `X` marks a row with no mean solution, `P` a mean solution that is an
   *  unresolved double's photocentre rather than one star's place. */
  flag: string | null;
  /** True where the position came from the J2000 cell because the row carries
   *  no mean solution — every supplement row, and main's `pflag='X'` set. */
  fromIcrs: boolean;
}

export function tycho2Key(tyc1: string, tyc2: string, tyc3: string): string {
  return `${tyc1.trim()}-${tyc2.trim()}-${tyc3.trim()}`;
}

/** `ra_mdeg` is the observed mean position and the only one a propagation may
 *  start from: `ra_icrs` is Tycho-2's own propagation of that same solution to
 *  J2000, so advancing it again compounds its error instead of correcting it.
 *  The J2000 cell is taken only where there is no mean solution to prefer —
 *  data/tycho2/README.md § Which position to propagate from. */
function resolvePosition(
  raMean: number | null, decMean: number | null,
  epochRa: number | null, epochDec: number | null,
  raIcrs: number | null, decIcrs: number | null,
): Pick<Tycho2Row, 'raDeg' | 'decDeg' | 'epochRa' | 'epochDec' | 'fromIcrs'> | null {
  if (raMean !== null && decMean !== null && epochRa !== null && epochDec !== null) {
    return {
      raDeg: raMean, decDeg: decMean,
      epochRa, epochDec, fromIcrs: false,
    };
  }
  if (raIcrs !== null && decIcrs !== null) {
    return {
      raDeg: raIcrs, decDeg: decIcrs,
      epochRa: TYCHO2_ICRS_EPOCH, epochDec: TYCHO2_ICRS_EPOCH, fromIcrs: true,
    };
  }
  return null;
}

/** Index both Tycho-2 tables on the full `TYC1-TYC2-TYC3` identifier.
 *
 *  **The main table wins on the 254 identifiers both carry.** Supplement 1 is
 *  documented as Tycho-1 stars absent from the main catalogue, but the overlap
 *  is real and the main row is the better one — it carries a mean epoch and a
 *  proper motion where 1,404 of the supplement's rows carry no PM at all. So
 *  the supplement is read only where the main table left the identifier
 *  unclaimed (data/tycho2/README.md § The two tables overlap on 254 TYCs). */
export function parseTycho2Tsvs(mainText: string, suppl1Text: string): Map<string, Tycho2Row> {
  const out = new Map<string, Tycho2Row>();

  for (const { cells, idx } of dataRows(mainText, MAIN_COLUMNS, MAIN_LABEL, REFRESH_HINT)) {
    const position = resolvePosition(
      parseFloatOrNull(cells[idx.ra_mdeg]), parseFloatOrNull(cells[idx.de_mdeg]),
      parseFloatOrNull(cells[idx.ep_ra]), parseFloatOrNull(cells[idx.ep_de]),
      parseFloatOrNull(cells[idx.ra_icrs]), parseFloatOrNull(cells[idx.de_icrs]),
    );
    if (position === null) continue;
    out.set(tycho2Key(cells[idx.tyc1] ?? '', cells[idx.tyc2] ?? '', cells[idx.tyc3] ?? ''), {
      ...position,
      pmRaMasyr: parseFloatOrNull(cells[idx.pm_ra]),
      pmDecMasyr: parseFloatOrNull(cells[idx.pm_de]),
      btMag: parseFloatOrNull(cells[idx.bt_mag]),
      vtMag: parseFloatOrNull(cells[idx.vt_mag]),
      flag: nonEmpty(cells[idx.pflag]),
    });
  }

  for (const { cells, idx } of dataRows(suppl1Text, SUPPL1_COLUMNS, SUPPL1_LABEL, REFRESH_HINT)) {
    const key = tycho2Key(cells[idx.tyc1] ?? '', cells[idx.tyc2] ?? '', cells[idx.tyc3] ?? '');
    if (out.has(key)) continue;
    const position = resolvePosition(
      null, null, null, null,
      parseFloatOrNull(cells[idx.ra_icrs]), parseFloatOrNull(cells[idx.de_icrs]),
    );
    if (position === null) continue;
    out.set(key, {
      ...position,
      pmRaMasyr: parseFloatOrNull(cells[idx.pm_ra]),
      pmDecMasyr: parseFloatOrNull(cells[idx.pm_de]),
      btMag: parseFloatOrNull(cells[idx.bt_mag]),
      vtMag: parseFloatOrNull(cells[idx.vt_mag]),
      flag: nonEmpty(cells[idx.flag]),
    });
  }

  return out;
}
