// Parsers for the frozen CDS classic-designation tables under
// data/classic-ids/. See data/classic-ids/README.md § Provenance.
import { dataRows, nonEmpty, parseIntOrNull } from '../parse/corpus-tsv';

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

/** One CNS5 row. `gaiaSourceId` is an EDR3 id, which shares DR3's
 *  source_id space and so joins the overlay directly. */
export interface Cns5Row {
  cns5: number;
  gj: string;
  gjComp: string | null;
  gaiaSourceId: string | null;
  hip: number | null;
}

const CNS5_COLUMNS = ['cns5', 'gj', 'gj_comp', 'gaia_source_id', 'hip'] as const;

export function parseCns5Tsv(text: string): Cns5Row[] {
  const out: Cns5Row[] = [];
  for (const { cells, idx } of dataRows(
    text, CNS5_COLUMNS, 'cns5.tsv', REFRESH_CLASSIC_IDS,
  )) {
    const cns5 = parseIntOrNull(cells[idx.cns5]);
    const gj = nonEmpty(cells[idx.gj]);
    if (cns5 === null || gj === null) continue;
    const src = nonEmpty(cells[idx.gaia_source_id]);
    out.push({
      cns5,
      gj,
      gjComp: nonEmpty(cells[idx.gj_comp]),
      gaiaSourceId: src !== null && /^\d+$/.test(src) ? src : null,
      hip: parseIntOrNull(cells[idx.hip]),
    });
  }
  return out;
}
