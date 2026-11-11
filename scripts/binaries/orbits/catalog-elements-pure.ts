// ORB6 and MSC orbit rows as canonical orbital elements, and the pick among one pair's rows. See README.md.

import { DAYS_PER_JULIAN_YEAR, DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import type { Orb6Entry } from '../../wds/wds-pure';
import { TRUNCATED_JD_TO_JD_OFFSET, mscPeriodDays, mscT0Jd, yearElseTruncatedJd, type MscOrbitRow } from '../load/msc-pure';
import { distancePc } from '../sky-geometry-pure';
import type { OrbitElements } from './nss-elements-pure';

export const MJD_TO_JD_OFFSET = 2400000.5;

/** Grades 1-5 are visual orbits; 7 (photometric / eclipsing, undocumented in
 *  the format text), 8 (interferometric) and 9 (astrometric / spectroscopic) are not. */
export const ORB6_VISUAL_GRADES: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
export const ORB6_SPECTROSCOPIC_GRADES: ReadonlySet<number> = new Set([7, 8, 9]);

const ORB6_PERIOD_DAYS: Readonly<Record<string, (p: number) => number>> = {
  y: (p) => p * DAYS_PER_JULIAN_YEAR,
  d: (p) => p,
  c: (p) => p * 100.0 * DAYS_PER_JULIAN_YEAR,
  h: (p) => p / 24.0,
  m: (p) => p / (24.0 * 60.0),
};

/** `M` is a typo of `m` in two rows. */
const ORB6_A_MAS: Readonly<Record<string, (a: number) => number>> = {
  a: (a) => a * 1000.0,
  m: (a) => a,
  M: (a) => a,
};

/** Null for an unknown unit (fixed-column misalignment) or a non-positive period. */
export function orb6PeriodDays(entry: Orb6Entry): number | null {
  if (entry.pVal === null || entry.pVal <= 0) return null;
  return Object.hasOwn(ORB6_PERIOD_DAYS, entry.pUnit) ? ORB6_PERIOD_DAYS[entry.pUnit](entry.pVal) : null;
}

function orb6SemimajorAu(entry: Orb6Entry, plxMas: number | null): number | null {
  if (entry.aVal === null || plxMas === null || plxMas <= 0) return null;
  return Object.hasOwn(ORB6_A_MAS, entry.aUnit) ? ORB6_A_MAS[entry.aUnit](entry.aVal) / plxMas : null;
}

/** `d` truncated JD, `m` MJD, `y` a Julian year — or, when that reading is
 *  implausible, a truncated JD ORB6 mislabelled `y`. Any other flag is null. */
export function orb6T0Jd(entry: Orb6Entry): number | null {
  const val = entry.t0Val;
  if (val === null) return null;
  switch (entry.t0Unit) {
    case 'd':
      return val + TRUNCATED_JD_TO_JD_OFFSET;
    case 'm':
      return val + MJD_TO_JD_OFFSET;
    case 'y':
      return yearElseTruncatedJd(val, true);
    default:
      return null;
  }
}

const degToRad = (deg: number | null): number | null => (deg === null ? null : deg * DEG_TO_RAD);

/** Null only for a period no unit reads; a missing T0 or parallax leaves its fields null. */
export function orb6ToCanonicalElements(entry: Orb6Entry, plxMas: number | null): OrbitElements | null {
  const pDays = orb6PeriodDays(entry);
  if (pDays === null) return null;
  return {
    pDays,
    tJd: orb6T0Jd(entry),
    e: entry.e,
    aAu: orb6SemimajorAu(entry, plxMas),
    iRad: degToRad(entry.iDeg),
    periastronRad: degToRad(entry.periastronDeg),
    nodeRad: degToRad(entry.nodeDeg),
    q: null,
    distancePc: distancePc(plxMas),
  };
}

/** A spectroscopic row carries P, T, e and ω only; `a` needs the parallax. */
export function mscToCanonicalElements(row: MscOrbitRow, plxMas: number | null): OrbitElements | null {
  const pDays = mscPeriodDays(row);
  if (pDays === null) return null;
  return {
    pDays,
    tJd: mscT0Jd(row.t0),
    e: row.e,
    aAu: row.aArcsec !== null && plxMas !== null && plxMas > 0 ? (row.aArcsec * 1000.0) / plxMas : null,
    iRad: degToRad(row.inclDeg),
    periastronRad: degToRad(row.longpDeg),
    nodeRad: degToRad(row.nodeDeg),
    q: null,
    distancePc: distancePc(plxMas),
  };
}

/** A ref's trailing four digits (`Ake2021`); 0 for a ref without a year. */
function refYear(e: Orb6Entry): number {
  const tail = e.ref.slice(-4);
  return /^\d+$/.test(tail) ? Number(tail) : 0;
}

/** Lowest grade, then the most recent ref; the first of equals. */
export function pickBestOrb6(entries: readonly Orb6Entry[]): Orb6Entry {
  return entries.reduce((best, e) =>
    e.grade < best.grade || (e.grade === best.grade && refYear(e) > refYear(best)) ? e : best);
}

function completeness(r: MscOrbitRow): number {
  return [r.per, r.t0, r.e, r.aArcsec, r.nodeDeg, r.longpDeg, r.inclDeg].filter((v) => v !== null).length;
}

/** The most complete element set; the last of equals, since the MSC appends
 *  an author's later edition after the original (ν Sco Aab,Ac). */
export function pickBestMsc(rows: readonly MscOrbitRow[]): MscOrbitRow {
  return rows.reduce((best, r) => (completeness(r) >= completeness(best) ? r : best));
}
