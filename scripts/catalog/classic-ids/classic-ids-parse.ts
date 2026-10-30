// Parsers for the frozen CDS classic-designation tables under
// data/classic-ids/. See /data/classic-ids/README.md#provenance.
import type { Declared } from '../../util/sources/source';
import { sourceRowRef, type RowKeyed, type SourceRowRef } from '../../util/sources/row-ref-pure';
import { readTable } from '../../util/tsv/table-pure';
import { normaliseGjKey } from '../record/catalog-pure';
import { citedParallax, type CitedParallax } from '../cited-parallax';
import { citedProperMotion, type CitedProperMotion } from '../cited-proper-motion';

const REFRESH_CLASSIC_IDS = 'Re-run `pnpm run refresh:classic-ids`.';

/** One IV/25 HD↔TYC identification. `nHd` / `nTyc` > 1 mark the upstream
 *  ambiguity flags the overlay's label-attachment policy keys on
 *  (/docs/catalog-driver.md#4-how-hd-reaches-gaia). */
export interface Tyc2HdRow {
  tyc: string;
  hd: number;
  nHd: number;
  nTyc: number;
}

const TYC2_HD_COLUMNS = ['tyc1', 'tyc2', 'tyc3', 'hd', 'n_hd', 'n_tyc'] as const;

export function parseTyc2HdTsv(text: string, from: Declared): Tyc2HdRow[] {
  const out: Tyc2HdRow[] = [];
  for (const row of readTable({ ...from, columns: TYC2_HD_COLUMNS }, text)) {
    const tyc1 = row.int('tyc1');
    const tyc2 = row.int('tyc2');
    const tyc3 = row.int('tyc3');
    const hd = row.int('hd');
    if (tyc1 === null || tyc2 === null || tyc3 === null || hd === null) continue;
    out.push({
      // Unpadded, matching gaia_dr3_tyc_xmatch.tsv's `tyc` key ("1-381-1").
      tyc: `${tyc1}-${tyc2}-${tyc3}`,
      hd,
      nHd: row.int('n_hd') ?? 1,
      nTyc: row.int('n_tyc') ?? 1,
    });
  }
  return out;
}

/** One IV/27A cross-index row. `bayer` is IV/27A's own lowercase
 *  three-letter form ("alf"), not AT-HYG's ("Alp"); `cst` is the
 *  constellation the Bayer / Flamsteed designation belongs to, never the
 *  IAU-positional constellation the catalogue assigns per record.
 *
 *  IV/27A's own `hr` is deliberately not carried: HR reaches the overlay
 *  through V/50, whose HR↔HD mapping is the Bright Star Catalogue's own. */
export interface CrossIndexRow {
  hd: number;
  hip: number | null;
  bayer: string | null;
  flamsteed: number | null;
  cst: string | null;
}

const CROSS_INDEX_COLUMNS = ['hd', 'hip', 'bayer', 'flamsteed', 'cst'] as const;

export function parseCrossIndexTsv(text: string, from: Declared): CrossIndexRow[] {
  const out: CrossIndexRow[] = [];
  for (const row of readTable({ ...from, columns: CROSS_INDEX_COLUMNS }, text)) {
    const hd = row.int('hd');
    if (hd === null) continue;
    out.push({
      hd,
      hip: row.int('hip'),
      bayer: row.text('bayer'),
      flamsteed: row.int('flamsteed'),
      cst: row.text('cst'),
    });
  }
  return out;
}

/** One curated IV/27A correction: `hd`'s Bayer / Flamsteed cells name the star
 *  `belongsTo` instead, so the row leaves the table. See
 *  README.md#one-designation-two-hd-numbers. */
export interface CrossIndexCorrection {
  hd: number;
  belongsTo: number;
}

export function parseCrossIndexCorrectionsTsv(text: string, from: Declared): CrossIndexCorrection[] {
  const out: CrossIndexCorrection[] = [];
  for (const row of readTable({ ...from, columns: ['hd', 'belongs_to'] as const, comments: true }, text)) {
    const hd = row.int('hd');
    const belongsTo = row.int('belongs_to');
    if (hd === null || belongsTo === null) return row.failIncompletePair('hd', 'belongs_to');
    out.push({ hd, belongsTo });
  }
  return out;
}

function designationCells(row: CrossIndexRow): string {
  return `${row.bayer ?? ''}|${row.flamsteed ?? ''}|${row.cst ?? ''}`;
}

/** Drop the corrected rows, hard-failing on any correction that would do
 *  nothing or would leave a designation with no row at all: the `hd` must have
 *  an IV/27A row stating a designation, and `belongsTo` must have one stating
 *  the identical cells. */
export function applyCrossIndexCorrections(
  rows: readonly CrossIndexRow[],
  corrections: readonly CrossIndexCorrection[],
  from: Declared,
): CrossIndexRow[] {
  const byHd = new Map<number, CrossIndexRow[]>();
  for (const row of rows) {
    const at = byHd.get(row.hd);
    if (at === undefined) byHd.set(row.hd, [row]);
    else at.push(row);
  }
  const dropped = new Set<CrossIndexRow>();
  for (const { hd, belongsTo } of corrections) {
    const withheld = (byHd.get(hd) ?? []).filter(
      (r) => r.bayer !== null || r.flamsteed !== null,
    );
    if (withheld.length === 0) {
      throw new Error(
        `${from.file} corrects HD ${hd}, which states no ` +
          'IV/27A designation to withhold.',
      );
    }
    const kept = new Set((byHd.get(belongsTo) ?? []).map(designationCells));
    for (const row of withheld) {
      if (!kept.has(designationCells(row))) {
        throw new Error(
          `${from.file} gives HD ${hd}'s ` +
            `"${designationCells(row)}" to HD ${belongsTo}, which IV/27A does ` +
            'not state it for — the correction would orphan the designation.',
        );
      }
      dropped.add(row);
    }
  }
  return rows.filter((r) => !dropped.has(r));
}

/** One V/50 Bright Star Catalogue row. `name` is the BSC's own designation
 *  string ("3Alp Lyr"); no consumer reads it yet — the naming-authority
 *  ladder is its own gate. */
export interface Bsc5Row {
  hr: number;
  hd: number | null;
  name: string | null;
}

const BSC5_COLUMNS = ['hr', 'hd', 'name'] as const;

export function parseBsc5Tsv(text: string, from: Declared): Bsc5Row[] {
  const out: Bsc5Row[] = [];
  for (const row of readTable({ ...from, columns: BSC5_COLUMNS }, text)) {
    const hr = row.int('hr');
    if (hr === null) continue;
    out.push({
      hr,
      hd: row.int('hd'),
      name: row.text('name'),
    });
  }
  return out;
}

/** CNS5's own astrometric solution for a row.
 *
 *  `posEpoch` is per-row and really varies — 5,244 rows state 2016.0 against
 *  406 at 2000.0, 138 at 1991.25, 36 at 2015.5 and 3 at 2016.55 — so a
 *  consumer propagating these coordinates reads the epoch off the row rather
 *  than assuming the catalogue's dominant one. */
export interface Cns5Astrometry {
  raDeg: number;
  decDeg: number;
  posEpoch: number;
  /** Admitted only with the bibcode that sourced it, for the reason the motion
   *  is: CNS5 republishes Gaia's own parallax on most rows, and the distance
   *  cascade's skip rule cannot see that without the citation. */
  parallax: CitedParallax | null;
  /** 87% of CNS5's proper motions are Gaia's own republished, so the PM
   *  rescue's skip rule cannot weigh one without its citation. Null where the
   *  row states no motion, or states it uncited — the position stands either
   *  way. */
  pm: CitedProperMotion | null;
  ref: SourceRowRef<number>;
}

/** One CNS5 row. `gaiaSourceId` is an EDR3 id, which shares DR3's
 *  source_id space and so joins the overlay directly. */
export interface Cns5Row {
  cns5: number;
  gj: string;
  gjComp: string | null;
  gaiaSourceId: string | null;
  hip: number | null;
  /** Null where the row states no position or no epoch to state it at —
   *  the direction cascade's CNS5 tier (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) needs both. */
  astrometry: Cns5Astrometry | null;
}

const CNS5_COLUMNS = [
    'cns5', 'gj', 'gj_comp', 'gaia_source_id', 'hip',
    'ra_deg', 'de_deg', 'pos_epoch', 'plx_mas', 'e_plx_mas', 'plx_bibcode',
    'pm_ra', 'pm_de', 'pm_bibcode',
  ] as const;

export function parseCns5Tsv(text: string, from: Declared & RowKeyed<number>): Cns5Row[] {
  const out: Cns5Row[] = [];
  for (const row of readTable({ ...from, columns: CNS5_COLUMNS }, text)) {
    const cns5 = row.int('cns5');
    const gj = row.text('gj');
    if (cns5 === null || gj === null) continue;
    const src = row.sourceId('gaia_source_id');
    const raDeg = row.float('ra_deg');
    const decDeg = row.float('de_deg');
    const posEpoch = row.float('pos_epoch');
    const ref = sourceRowRef(from, cns5);
    out.push({
      cns5,
      gj,
      gjComp: row.text('gj_comp'),
      gaiaSourceId: src !== null && /^\d+$/.test(src) ? src : null,
      hip: row.int('hip'),
      astrometry: raDeg !== null && decDeg !== null && posEpoch !== null
        ? {
            raDeg, decDeg, posEpoch,
            parallax: citedParallax(
              row.float('plx_mas'),
              row.float('e_plx_mas'),
              row.text('plx_bibcode'),
              ref,
            ),
            pm: citedProperMotion(
              row.float('pm_ra'),
              row.float('pm_de'),
              row.text('pm_bibcode'),
              ref,
            ),
            ref,
          }
        : null,
    });
  }
  return out;
}

/** Keyed on the record's own `gl` cell through `normaliseGjKey`, COMPONENT
 *  LETTER INCLUDED, so this names the component rather than the system. Exact
 *  `number+comp` keys are laid down first and a repeat throws: two rows
 *  claiming one component is an upstream change, never a binding to arbitrate
 *  silently. Each letter of a combined `gj_comp` then aliases onto its row,
 *  never displacing an exact key.
 *
 *  **Unlike V/70A's, this index carries NO bare-number fold.** A position and
 *  a proper motion belong to one component, so answering a bare number with
 *  whichever component CNS5 lists first would swap a per-object measurement
 *  for a sibling's from a HIGHER tier. */
export function cns5AstrometryByGj(rows: readonly Cns5Row[]): Map<string, Cns5Astrometry> {
  const out = new Map<string, Cns5Astrometry>();
  for (const row of rows) {
    if (row.astrometry === null) continue;
    const key = normaliseGjKey(`${row.gj}${row.gjComp ?? ''}`);
    if (key === null) continue;
    if (out.has(key)) {
      throw new Error(
        `CNS5 has two rows keyed gj=${key}. ${REFRESH_CLASSIC_IDS}`,
      );
    }
    out.set(key, row.astrometry);
  }
  for (const row of rows) {
    if (row.astrometry === null) continue;
    const bare = normaliseGjKey(row.gj);
    if (bare === null) continue;
    for (const letter of row.gjComp ?? '') {
      const alias = `${bare}${letter}`.toUpperCase();
      if (!out.has(alias)) out.set(alias, row.astrometry);
    }
  }
  return out;
}

/** {@link cns5AstrometryByGj}'s index read the way a record asks for it, so the
 *  direction cascade and the PM rescue fold the `gl` cell identically. */
export function lookupCns5Astrometry(
  index: ReadonlyMap<string, Cns5Astrometry>,
  gl: string | null,
): Cns5Astrometry | null {
  const key = gl === null ? null : normaliseGjKey(gl);
  return key === null ? null : index.get(key) ?? null;
}
