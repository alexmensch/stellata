// Parser and per-record lookup for data/simbad/simbad_values.tsv — the
// bibcoded bottom tier of the § 5 value cascades. See README.md § Files in
// this area.

import { dataRows, nonEmpty, parseFloatOrNull, parseIntOrNull } from './parse/corpus-tsv';
import {
  emptySimbadNamespaceIndex,
  indexSimbadRow,
  walkSimbadNamespaces,
  type SimbadNamespaceIndex,
  type SimbadRecordKeys,
} from './catalog-pure';
import { citedParallax, type CitedParallax } from './cited-parallax';
import { citedProperMotion, type CitedProperMotion } from './cited-proper-motion';

const FILE_LABEL = 'data/simbad/simbad_values.tsv';
const REFRESH_HINT = 'Re-run `pnpm run refresh:simbad-values`.';

const COLUMNS = [
  'rvz_radvel', 'rvz_type', 'rvz_bibcode',
  'ra', 'dec', 'coo_bibcode', 'pmra', 'pmdec', 'pm_bibcode',
  'plx_value', 'plx_err', 'plx_bibcode',
  'hip', 'source_id', 'tyc', 'gj',
] as const;

/** One SIMBAD row's radial velocity, with the bibcode that is its actual
 *  source. */
export interface SimbadRadialVelocity {
  kmS: number;
  bibcode: string;
}

/** One SIMBAD row's position and proper motion, each with the bibcode that is
 *  its actual source. Coordinates are ICRS at {@link SIMBAD_REF_EPOCH}; the
 *  PM is carried separately because SIMBAD bibcodes the two quantities
 *  independently and a row can hold a coordinate without a motion. */
export interface SimbadAstrometry {
  raDeg: number;
  decDeg: number;
  cooBibcode: string;
  pm: CitedProperMotion | null;
}

export interface SimbadValueRow {
  rv: SimbadRadialVelocity | null;
  /** A third independently-bibcoded quantity rather than part of the
   *  astrometry: SIMBAD routinely holds a parallax for a row whose position it
   *  sources elsewhere, and the distance cascade's skip rules turn on this
   *  bibcode alone. */
  parallax: CitedParallax | null;
  astrometry: SimbadAstrometry | null;
}

export interface SimbadValueIndex extends SimbadNamespaceIndex<SimbadValueRow> {
  /** Data rows read, counted at the walk rather than derived from the maps:
   *  the pull also enumerates by SIMBAD oid, so a row carrying none of the
   *  four ids is joinable by nothing and must still be counted. */
  rowCount: number;
}

export function emptySimbadValueIndex(): SimbadValueIndex {
  return { ...emptySimbadNamespaceIndex<SimbadValueRow>(), rowCount: 0 };
}


/** SIMBAD's `rvz_radvel` is a radial velocity only where `rvz_type` reads
 *  `v`. A `z` row carries a redshift-derived quantity, which on a catalogue
 *  bounded at 50 kpc is never a stellar line-of-sight velocity — EGGR 252
 *  reads 243,879 km/s. An unbibcoded value cannot arrive (the pull drops the
 *  whole quantity at write time), so the bibcode check here guards a
 *  re-pulled file rather than this one. */
function parseRv(cells: string[], idx: Record<string, number>): SimbadRadialVelocity | null {
  if (nonEmpty(cells[idx.rvz_type]) !== 'v') return null;
  const kmS = parseFloatOrNull(cells[idx.rvz_radvel]);
  const bibcode = nonEmpty(cells[idx.rvz_bibcode]);
  if (kmS === null || bibcode === null) return null;
  return { kmS, bibcode };
}

/** A position is consumable only with the bibcode that sourced it — the
 *  bibcode is the source and SIMBAD the index that found it — so an
 *  unbibcoded coordinate is dropped whole. The pull already drops it at write
 *  time, so this guards a re-pulled file rather than this one.
 *
 *  The proper motion is admitted separately and may be absent under a present
 *  coordinate: the two carry independent bibcodes upstream, and a row with a
 *  position but no motion is a real shape (the tier keeps the position and
 *  takes a zero tangential term). A PM missing its own bibcode is dropped the
 *  same way, leaving the position standing. */
function parseAstrometry(
  cells: string[], idx: Record<string, number>,
): SimbadAstrometry | null {
  const raDeg = parseFloatOrNull(cells[idx.ra]);
  const decDeg = parseFloatOrNull(cells[idx.dec]);
  const cooBibcode = nonEmpty(cells[idx.coo_bibcode]);
  if (raDeg === null || decDeg === null || cooBibcode === null) return null;
  return {
    raDeg, decDeg, cooBibcode,
    pm: citedProperMotion(
      parseFloatOrNull(cells[idx.pmra]),
      parseFloatOrNull(cells[idx.pmdec]),
      nonEmpty(cells[idx.pm_bibcode]),
    ),
  };
}

/** Index the values pull by every identifier namespace it keyed on. No key
 *  in any namespace collides in the committed file, so a duplicate is an
 *  upstream schema change and throws rather than silently overwriting a
 *  binding the cascade would then read off the wrong star. */
export function parseSimbadValuesTsv(text: string): SimbadValueIndex {
  const index = emptySimbadValueIndex();
  for (const { cells, idx } of dataRows(text, COLUMNS, FILE_LABEL, REFRESH_HINT)) {
    const keys: SimbadRecordKeys = {
      sourceId: nonEmpty(cells[idx.source_id]),
      hip: parseIntOrNull(cells[idx.hip]),
      tyc: nonEmpty(cells[idx.tyc]),
      gl: nonEmpty(cells[idx.gj]),
    };
    const row: SimbadValueRow = {
      rv: parseRv(cells, idx),
      parallax: citedParallax(
        parseFloatOrNull(cells[idx.plx_value]),
        parseFloatOrNull(cells[idx.plx_err]),
        nonEmpty(cells[idx.plx_bibcode]),
      ),
      astrometry: parseAstrometry(cells, idx),
    };
    indexSimbadRow(index, keys, row, (namespace, key) => {
      throw new Error(
        `${FILE_LABEL} has two rows keyed ${namespace}=${key}. ${REFRESH_HINT}`,
      );
    });
    index.rowCount++;
  }
  return index;
}

/** The record's SIMBAD row over the namespaces `resolve_spine_keys` composed
 *  the request from, source_id → HIP → TYC → GJ. A widened row is readable
 *  not because the two ladders share an order but because its emitted row
 *  carries the asking designation in the namespace that bound it, so this
 *  walk reaches it whichever rung matches first. What arrives here is already
 *  adjudicated (`scripts/refresh/simbad/README.md` § The widening carries its
 *  own corroboration rule). Its `source_id` cell may name a DIFFERENT source
 *  from the record's — the DR2/DR3 case, inert because no record asks for it,
 *  and pinned in `spine/inherited-spine-guard.test.ts`. */
export function lookupSimbadValues(
  index: SimbadValueIndex,
  keys: SimbadRecordKeys,
): SimbadValueRow | null {
  return walkSimbadNamespaces(index, keys, (row) => row)?.value ?? null;
}
