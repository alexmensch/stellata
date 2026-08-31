// Parsers for the frozen CDS classic-designation tables under
// data/classic-ids/. See data/classic-ids/README.md § Provenance.
import { dataRows, nonEmpty, parseFloatOrNull, parseIntOrNull } from '../parse/corpus-tsv';
import { normaliseGjKey } from '../catalog-pure';

const REFRESH_CLASSIC_IDS = 'Re-run `pnpm run refresh:classic-ids`.';

/** One IV/25 HD↔TYC identification. `nHd` / `nTyc` > 1 mark the upstream
 *  ambiguity flags the overlay's label-attachment policy keys on
 *  (docs/catalog-driver.md § 4). */
export interface Tyc2HdRow {
  tyc: string;
  hd: number;
  nHd: number;
  nTyc: number;
}

const TYC2_HD_COLUMNS = ['tyc1', 'tyc2', 'tyc3', 'hd', 'n_hd', 'n_tyc'] as const;

export function parseTyc2HdTsv(text: string): Tyc2HdRow[] {
  const out: Tyc2HdRow[] = [];
  for (const { cells, idx } of dataRows(
    text, TYC2_HD_COLUMNS, 'tyc2_hd.tsv', REFRESH_CLASSIC_IDS,
  )) {
    const tyc1 = parseIntOrNull(cells[idx.tyc1]);
    const tyc2 = parseIntOrNull(cells[idx.tyc2]);
    const tyc3 = parseIntOrNull(cells[idx.tyc3]);
    const hd = parseIntOrNull(cells[idx.hd]);
    if (tyc1 === null || tyc2 === null || tyc3 === null || hd === null) continue;
    out.push({
      // Unpadded, matching gaia_dr3_tyc_xmatch.tsv's `tyc` key ("1-381-1").
      tyc: `${tyc1}-${tyc2}-${tyc3}`,
      hd,
      nHd: parseIntOrNull(cells[idx.n_hd]) ?? 1,
      nTyc: parseIntOrNull(cells[idx.n_tyc]) ?? 1,
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

export function parseCrossIndexTsv(text: string): CrossIndexRow[] {
  const out: CrossIndexRow[] = [];
  for (const { cells, idx } of dataRows(
    text, CROSS_INDEX_COLUMNS, 'cross_index.tsv', REFRESH_CLASSIC_IDS,
  )) {
    const hd = parseIntOrNull(cells[idx.hd]);
    if (hd === null) continue;
    out.push({
      hd,
      hip: parseIntOrNull(cells[idx.hip]),
      bayer: nonEmpty(cells[idx.bayer]),
      flamsteed: parseIntOrNull(cells[idx.flamsteed]),
      cst: nonEmpty(cells[idx.cst]),
    });
  }
  return out;
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

export function parseBsc5Tsv(text: string): Bsc5Row[] {
  const out: Bsc5Row[] = [];
  for (const { cells, idx } of dataRows(
    text, BSC5_COLUMNS, 'bsc5.tsv', REFRESH_CLASSIC_IDS,
  )) {
    const hr = parseIntOrNull(cells[idx.hr]);
    if (hr === null) continue;
    out.push({
      hr,
      hd: parseIntOrNull(cells[idx.hd]),
      name: nonEmpty(cells[idx.name]),
    });
  }
  return out;
}

/** CNS5's own astrometric solution for a row.
 *
 *  `posEpoch` is per-row and really varies — 5,244 rows state 2016.0 against
 *  406 at 2000.0, 138 at 1991.25, 36 at 2015.5 and 3 at 2016.55 — so a
 *  consumer propagating these coordinates reads the epoch off the row rather
 *  than assuming the catalogue's dominant one. `pmRaMasyr` is μ_α*, cos δ
 *  already applied. */
export interface Cns5Astrometry {
  raDeg: number;
  decDeg: number;
  posEpoch: number;
  plxMas: number | null;
  pmRaMasyr: number | null;
  pmDecMasyr: number | null;
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
   *  the § 5 direction cascade's CNS5 tier needs both. */
  astrometry: Cns5Astrometry | null;
}

const CNS5_COLUMNS = [
  'cns5', 'gj', 'gj_comp', 'gaia_source_id', 'hip',
  'ra_deg', 'de_deg', 'pos_epoch', 'plx_mas', 'pm_ra', 'pm_de',
] as const;

export function parseCns5Tsv(text: string): Cns5Row[] {
  const out: Cns5Row[] = [];
  for (const { cells, idx } of dataRows(
    text, CNS5_COLUMNS, 'cns5.tsv', REFRESH_CLASSIC_IDS,
  )) {
    const cns5 = parseIntOrNull(cells[idx.cns5]);
    const gj = nonEmpty(cells[idx.gj]);
    if (cns5 === null || gj === null) continue;
    const src = nonEmpty(cells[idx.gaia_source_id]);
    const raDeg = parseFloatOrNull(cells[idx.ra_deg]);
    const decDeg = parseFloatOrNull(cells[idx.de_deg]);
    const posEpoch = parseFloatOrNull(cells[idx.pos_epoch]);
    out.push({
      cns5,
      gj,
      gjComp: nonEmpty(cells[idx.gj_comp]),
      gaiaSourceId: src !== null && /^\d+$/.test(src) ? src : null,
      hip: parseIntOrNull(cells[idx.hip]),
      astrometry: raDeg !== null && decDeg !== null && posEpoch !== null
        ? {
            raDeg, decDeg, posEpoch,
            plxMas: parseFloatOrNull(cells[idx.plx_mas]),
            pmRaMasyr: parseFloatOrNull(cells[idx.pm_ra]),
            pmDecMasyr: parseFloatOrNull(cells[idx.pm_de]),
          }
        : null,
    });
  }
  return out;
}

/** CNS5's astrometry keyed the way a record asks for it: on its own `gl`
 *  cell, folded through `normaliseGjKey` so `Gl 165A` / `GJ 165A` / `165 A`
 *  — and CNS5's own `165.0` — meet as one key, the same reduction the SIMBAD
 *  ladder's GJ namespace uses. The component letter is part of the key because
 *  a GJ number carries one, so this names the component rather than the system.
 *
 *  A repeat throws, as it does in every other index over a committed table
 *  here: two rows sharing a GJ number would be one star's components, which
 *  their letters keep apart, so a collision is an upstream change rather than
 *  a binding to arbitrate silently. */
export function cns5AstrometryByGj(rows: readonly Cns5Row[]): Map<string, Cns5Astrometry> {
  const out = new Map<string, Cns5Astrometry>();
  for (const row of rows) {
    if (row.astrometry === null) continue;
    const key = normaliseGjKey(`${row.gj}${row.gjComp ?? ''}`);
    if (key === null) continue;
    if (out.has(key)) {
      throw new Error(
        `data/classic-ids/cns5.tsv has two rows keyed gj=${key}. ${REFRESH_CLASSIC_IDS}`,
      );
    }
    out.set(key, row.astrometry);
  }
  return out;
}
