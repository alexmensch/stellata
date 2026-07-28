// Parsers for the four frozen CDS classic-designation tables under
// data/classic-ids/. See README.md § Frozen inputs.
import { nonEmpty, parseIntOrNull } from '../parse/corpus-tsv';

/** Header-keyed TSV rows. Blank lines are dropped; short rows yield
 *  undefined cells, which every `nonEmpty` / `parseIntOrNull` call below
 *  already treats as absent. */
function tsvRecords(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const fields = line.split('\t');
    const row: Record<string, string> = {};
    header.forEach((col, i) => (row[col] = fields[i] ?? ''));
    return row;
  });
}

function requireColumns(
  rows: Record<string, string>[],
  file: string,
  columns: readonly string[],
): void {
  if (rows.length === 0) return;
  const missing = columns.filter((c) => !(c in rows[0]));
  if (missing.length > 0) {
    throw new Error(`${file}: missing columns ${missing.join(', ')}`);
  }
}

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
  const rows = tsvRecords(text);
  requireColumns(rows, 'tyc2_hd.tsv', TYC2_HD_COLUMNS);
  const out: Tyc2HdRow[] = [];
  for (const row of rows) {
    const tyc1 = parseIntOrNull(row.tyc1);
    const tyc2 = parseIntOrNull(row.tyc2);
    const tyc3 = parseIntOrNull(row.tyc3);
    const hd = parseIntOrNull(row.hd);
    if (tyc1 === null || tyc2 === null || tyc3 === null || hd === null) continue;
    out.push({
      // Unpadded, matching gaia_dr3_tyc_xmatch.tsv's `tyc` key ("1-381-1").
      tyc: `${tyc1}-${tyc2}-${tyc3}`,
      hd,
      nHd: parseIntOrNull(row.n_hd) ?? 1,
      nTyc: parseIntOrNull(row.n_tyc) ?? 1,
    });
  }
  return out;
}

/** One IV/27A cross-index row. `bayer` is IV/27A's own lowercase
 *  three-letter form ("alf"), not AT-HYG's ("Alp"); `cst` is the
 *  constellation the Bayer / Flamsteed designation belongs to, never the
 *  IAU-positional constellation the catalogue assigns per record. */
export interface CrossIndexRow {
  hd: number;
  hr: number | null;
  hip: number | null;
  bayer: string | null;
  flamsteed: number | null;
  cst: string | null;
}

const CROSS_INDEX_COLUMNS = ['hd', 'hr', 'hip', 'bayer', 'flamsteed', 'cst'] as const;

export function parseCrossIndexTsv(text: string): CrossIndexRow[] {
  const rows = tsvRecords(text);
  requireColumns(rows, 'cross_index.tsv', CROSS_INDEX_COLUMNS);
  const out: CrossIndexRow[] = [];
  for (const row of rows) {
    const hd = parseIntOrNull(row.hd);
    if (hd === null) continue;
    out.push({
      hd,
      hr: parseIntOrNull(row.hr),
      hip: parseIntOrNull(row.hip),
      bayer: nonEmpty(row.bayer),
      flamsteed: parseIntOrNull(row.flamsteed),
      cst: nonEmpty(row.cst),
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
  const rows = tsvRecords(text);
  requireColumns(rows, 'bsc5.tsv', BSC5_COLUMNS);
  const out: Bsc5Row[] = [];
  for (const row of rows) {
    const hr = parseIntOrNull(row.hr);
    if (hr === null) continue;
    out.push({ hr, hd: parseIntOrNull(row.hd), name: nonEmpty(row.name) });
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
  const rows = tsvRecords(text);
  requireColumns(rows, 'cns5.tsv', CNS5_COLUMNS);
  const out: Cns5Row[] = [];
  for (const row of rows) {
    const cns5 = parseIntOrNull(row.cns5);
    const gj = nonEmpty(row.gj);
    if (cns5 === null || gj === null) continue;
    const src = nonEmpty(row.gaia_source_id);
    out.push({
      cns5,
      gj,
      gjComp: nonEmpty(row.gj_comp),
      gaiaSourceId: src !== null && /^\d+$/.test(src) ? src : null,
      hip: parseIntOrNull(row.hip),
    });
  }
  return out;
}
