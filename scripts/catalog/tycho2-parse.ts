// Parser and per-record lookup for data/tycho2/{tycho2_main,tycho2_suppl1}.tsv
// — the first-order tier under HIP2 in the direction, PM and V cascades (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers).
// See data/tycho2/README.md.

import type { Declared } from '../util/sources/source';
import { sourceRowRef, type RowKeyed, type SourceRowRef } from '../util/sources/row-ref-pure';
import { readTable } from '../util/tsv/table-pure';

/** `pflag='P'` on the main table: the mean solution is an unresolved double's
 *  photocentre rather than one star's place. */
const MAIN_PFLAG_PHOTOCENTRE = 'P';

const MAIN_COLUMNS = [
    'tyc1', 'tyc2', 'tyc3', 'pflag',
    'ra_mdeg', 'de_mdeg', 'pm_ra', 'pm_de',
    'ra_icrs', 'de_icrs', 'bt_mag', 'vt_mag', 'hip',
  ] as const;

const SUPPL1_COLUMNS = [
    'tyc1', 'tyc2', 'tyc3',
    'ra_icrs', 'de_icrs', 'pm_ra', 'pm_de', 'bt_mag', 'vt_mag', 'hip',
  ] as const;

/** The epoch `ra_mdeg` / `de_mdeg` is stated at.
 *
 *  NOT `ep_ra` / `ep_de`. Those are the mean epoch of the OBSERVATIONS the mean
 *  solution was fitted to — they describe when the star was watched, not when
 *  its position holds — and reading them as the position's epoch over-advances
 *  every row by `2000 - ep_ra`, which reaches 81.7 years on this table and
 *  32.2 across the direction tier's own cohort
 *  (/data/tycho2/README.md#which-position-to-propagate-from). */
export const TYCHO2_MEAN_EPOCH = 2000.0;

/** The epoch a `ra_icrs` / `de_icrs` cell is stated at: Tycho-2's observed
 *  position, which the catalogue publishes at J1991.25 rather than J2000. */
export const TYCHO2_ICRS_EPOCH = 1991.25;

/** One Tycho-2 entry, with the position choice already made — `raDeg` /
 *  `decDeg` is the position to propagate FROM, at `epoch`
 *  (/data/tycho2/README.md#which-position-to-propagate-from). `pmRaMasyr` is
 *  μ_α*, cos δ already applied; never divide by cos δ again. */
export interface Tycho2Row {
  raDeg: number;
  decDeg: number;
  epoch: number;
  pmRaMasyr: number | null;
  pmDecMasyr: number | null;
  btMag: number | null;
  vtMag: number | null;
  /** True where the position came from the observed cell because the row
   *  carries no mean solution — every supplement row, and main's `pflag='X'`
   *  set. Those two cells are stated at different epochs, so this is also
   *  which of the two `epoch` holds. */
  fromIcrs: boolean;
  /** True where this row's position and photometry describe the blended
   *  photocentre of a double Tycho-2 did not resolve, not one star. Both
   *  cascades reading the row need it: the direction tier counts it, and a V
   *  from it is a system blend. */
  isPhotocentre: boolean;
  ref: SourceRowRef<string>;
  /** The HIP number Tycho-2 itself names for this entry, its own cross-index
   *  to I/239 rather than a walk's verdict. */
  hip: number | null;
}

export function tycho2Key(tyc1: string, tyc2: string, tyc3: string): string {
  return `${tyc1.trim()}-${tyc2.trim()}-${tyc3.trim()}`;
}

type Tycho2Position = Pick<Tycho2Row, 'raDeg' | 'decDeg' | 'epoch' | 'fromIcrs'>;

/** The mean solution's position, which a propagation must start from.
 *  /data/tycho2/README.md#which-position-to-propagate-from. */
function meanPosition(
  raMean: number | null, decMean: number | null,
): Tycho2Position | null {
  if (raMean === null || decMean === null) return null;
  return { raDeg: raMean, decDeg: decMean, epoch: TYCHO2_MEAN_EPOCH, fromIcrs: false };
}

/** The observed J1991.25 cell, for rows with no mean solution to prefer. */
function icrsPosition(
  raIcrs: number | null, decIcrs: number | null,
): Tycho2Position | null {
  if (raIcrs === null || decIcrs === null) return null;
  return {
    raDeg: raIcrs, decDeg: decIcrs, epoch: TYCHO2_ICRS_EPOCH, fromIcrs: true,
  };
}

/** Index both Tycho-2 tables on the full `TYC1-TYC2-TYC3` identifier. The main
 *  table wins where both carry one — /data/tycho2/README.md#the-two-tables-overlap-on-254-tycs.
 * */
export function parseTycho2Tsvs(
  main: { text: string; from: Declared },
  suppl1: { text: string; from: Declared },
  source: RowKeyed<string>,
): Map<string, Tycho2Row> {
  const out = new Map<string, Tycho2Row>();

  for (const row of readTable({ ...main.from, columns: MAIN_COLUMNS }, main.text)) {
    const position = meanPosition(
      row.float('ra_mdeg'), row.float('de_mdeg'),
    ) ?? icrsPosition(
      row.float('ra_icrs'), row.float('de_icrs'),
    );
    if (position === null) continue;
    const key = tycho2Key(row.raw('tyc1'), row.raw('tyc2'), row.raw('tyc3'));
    out.set(key, {
      ...position,
      pmRaMasyr: row.float('pm_ra'),
      pmDecMasyr: row.float('pm_de'),
      btMag: row.float('bt_mag'),
      vtMag: row.float('vt_mag'),
      isPhotocentre: row.text('pflag') === MAIN_PFLAG_PHOTOCENTRE,
      hip: row.int('hip'),
      ref: sourceRowRef(source, key),
    });
  }

  // Supplement 1 carries Tycho-1 and Hipparcos stars at an observed position
  // only, and states no photocentre flag.
  for (const row of readTable({ ...suppl1.from, columns: SUPPL1_COLUMNS }, suppl1.text)) {
    const key = tycho2Key(row.raw('tyc1'), row.raw('tyc2'), row.raw('tyc3'));
    if (out.has(key)) continue;
    const position = icrsPosition(
      row.float('ra_icrs'), row.float('de_icrs'),
    );
    if (position === null) continue;
    out.set(key, {
      ...position,
      pmRaMasyr: row.float('pm_ra'),
      pmDecMasyr: row.float('pm_de'),
      btMag: row.float('bt_mag'),
      vtMag: row.float('vt_mag'),
      isPhotocentre: false,
      hip: row.int('hip'),
      ref: sourceRowRef(source, key),
    });
  }

  return out;
}
