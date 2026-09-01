// Parser and per-record lookup for data/tycho2/{tycho2_main,tycho2_suppl1}.tsv
// — the first-order tier under HIP2 in the § 5 direction, PM and V cascades.
// See data/tycho2/README.md.

import { dataRows, parseFloatOrNull } from './parse/corpus-tsv';

const MAIN_LABEL = 'data/tycho2/tycho2_main.tsv';
const SUPPL1_LABEL = 'data/tycho2/tycho2_suppl1.tsv';
const REFRESH_HINT = 'Re-run `pnpm run refresh:tycho2`.';

/** `pflag='P'` on the main table: the mean solution is an unresolved double's
 *  photocentre rather than one star's place. */
const MAIN_PFLAG_PHOTOCENTRE = 'P';

const MAIN_COLUMNS = [
  'tyc1', 'tyc2', 'tyc3', 'pflag',
  'ra_mdeg', 'de_mdeg', 'ep_ra', 'ep_de', 'pm_ra', 'pm_de',
  'ra_icrs', 'de_icrs', 'bt_mag', 'vt_mag',
] as const;

const SUPPL1_COLUMNS = [
  'tyc1', 'tyc2', 'tyc3',
  'ra_icrs', 'de_icrs', 'pm_ra', 'pm_de', 'bt_mag', 'vt_mag',
] as const;

/** The epoch a `ra_icrs` / `de_icrs` cell is stated at. Tycho-2 publishes it as
 *  its own propagation of the mean solution to J2000, so a row falling back to
 *  it advances from there rather than from a mean epoch it has none of. */
export const TYCHO2_ICRS_EPOCH = 2000.0;

/** One Tycho-2 entry, with the position choice already made — `raDeg` /
 *  `decDeg` is the position to propagate FROM, at `epochRa` / `epochDec`,
 *  which differ per coordinate (data/tycho2/README.md § Which position to
 *  propagate from). `pmRaMasyr` is μ_α*, cos δ already applied; never divide
 *  by cos δ again. */
export interface Tycho2Row {
  raDeg: number;
  decDeg: number;
  epochRa: number;
  epochDec: number;
  pmRaMasyr: number | null;
  pmDecMasyr: number | null;
  btMag: number | null;
  vtMag: number | null;
  /** True where the position came from the J2000 cell because the row carries
   *  no mean solution — every supplement row, and main's `pflag='X'` set. */
  fromIcrs: boolean;
  /** True where this row's position and photometry describe the blended
   *  photocentre of a double Tycho-2 did not resolve, not one star. Both
   *  cascades reading the row need it: the direction tier counts it, and a V
   *  from it is a system blend. */
  isPhotocentre: boolean;
}

export function tycho2Key(tyc1: string, tyc2: string, tyc3: string): string {
  return `${tyc1.trim()}-${tyc2.trim()}-${tyc3.trim()}`;
}

type Tycho2Position =
  Pick<Tycho2Row, 'raDeg' | 'decDeg' | 'epochRa' | 'epochDec' | 'fromIcrs'>;

/** The observed mean position, which a propagation must start from — and which
 *  needs both of its per-coordinate epochs to be usable at all.
 *  data/tycho2/README.md § Which position to propagate from. */
function meanPosition(
  raMean: number | null, decMean: number | null,
  epochRa: number | null, epochDec: number | null,
): Tycho2Position | null {
  if (raMean === null || decMean === null || epochRa === null || epochDec === null) {
    return null;
  }
  return { raDeg: raMean, decDeg: decMean, epochRa, epochDec, fromIcrs: false };
}

/** The J2000 cell, for rows with no mean solution to prefer. */
function icrsPosition(
  raIcrs: number | null, decIcrs: number | null,
): Tycho2Position | null {
  if (raIcrs === null || decIcrs === null) return null;
  return {
    raDeg: raIcrs, decDeg: decIcrs,
    epochRa: TYCHO2_ICRS_EPOCH, epochDec: TYCHO2_ICRS_EPOCH, fromIcrs: true,
  };
}

/** Index both Tycho-2 tables on the full `TYC1-TYC2-TYC3` identifier. The main
 *  table wins where both carry one — data/tycho2/README.md § The two tables
 *  overlap on 254 TYCs. */
export function parseTycho2Tsvs(mainText: string, suppl1Text: string): Map<string, Tycho2Row> {
  const out = new Map<string, Tycho2Row>();

  for (const { cells, idx } of dataRows(mainText, MAIN_COLUMNS, MAIN_LABEL, REFRESH_HINT)) {
    const position = meanPosition(
      parseFloatOrNull(cells[idx.ra_mdeg]), parseFloatOrNull(cells[idx.de_mdeg]),
      parseFloatOrNull(cells[idx.ep_ra]), parseFloatOrNull(cells[idx.ep_de]),
    ) ?? icrsPosition(
      parseFloatOrNull(cells[idx.ra_icrs]), parseFloatOrNull(cells[idx.de_icrs]),
    );
    if (position === null) continue;
    out.set(tycho2Key(cells[idx.tyc1] ?? '', cells[idx.tyc2] ?? '', cells[idx.tyc3] ?? ''), {
      ...position,
      pmRaMasyr: parseFloatOrNull(cells[idx.pm_ra]),
      pmDecMasyr: parseFloatOrNull(cells[idx.pm_de]),
      btMag: parseFloatOrNull(cells[idx.bt_mag]),
      vtMag: parseFloatOrNull(cells[idx.vt_mag]),
      isPhotocentre: (cells[idx.pflag] ?? '').trim() === MAIN_PFLAG_PHOTOCENTRE,
    });
  }

  // Supplement 1 carries Tycho-1 and Hipparcos stars at a J2000 position only,
  // and states no photocentre flag.
  for (const { cells, idx } of dataRows(suppl1Text, SUPPL1_COLUMNS, SUPPL1_LABEL, REFRESH_HINT)) {
    const key = tycho2Key(cells[idx.tyc1] ?? '', cells[idx.tyc2] ?? '', cells[idx.tyc3] ?? '');
    if (out.has(key)) continue;
    const position = icrsPosition(
      parseFloatOrNull(cells[idx.ra_icrs]), parseFloatOrNull(cells[idx.de_icrs]),
    );
    if (position === null) continue;
    out.set(key, {
      ...position,
      pmRaMasyr: parseFloatOrNull(cells[idx.pm_ra]),
      pmDecMasyr: parseFloatOrNull(cells[idx.pm_de]),
      btMag: parseFloatOrNull(cells[idx.bt_mag]),
      vtMag: parseFloatOrNull(cells[idx.vt_mag]),
      isPhotocentre: false,
    });
  }

  return out;
}
