// Parser for data/simbad/simbad_tyc_hd.tsv, indexed on the full TYC — the
// HD-attribution witness independent of IV/25.
// See data/simbad/README.md § The TYC → HD pull.

import { dataRows, nonEmpty, parseIntOrNull } from './parse/corpus-tsv';

const LABEL = 'data/simbad/simbad_tyc_hd.tsv';
const REFRESH_HINT =
  'Re-run `python3 scripts/refresh/refresh-simbad-tyc-hd.py`.';

const COLUMNS = ['tyc', 'simbad_oid', 'simbad_main_id', 'hd'] as const;

export interface SimbadTycHdRow {
  /** The HD idents' suffixes as SIMBAD states them, component letter
   *  included (`24071`, `24071B`). Several means SIMBAD's object for this
   *  Tycho entry holds more than one HD — an unresolved pair's entry carrying
   *  both components' numbers — which is the ambiguity a consumer is asking
   *  about, so nothing here picks a winner. */
  hdIdents: readonly string[];
  simbadOid: number;
  mainId: string | null;
}

/** The bare HD numbers a row attributes, component letters dropped and
 *  deduplicated in first-seen order — what a comparison against IV/25's
 *  integer `hd` column needs. A suffix carrying no leading integer
 *  contributes nothing rather than a NaN. */
export function hdNumbers(row: SimbadTycHdRow): number[] {
  const out: number[] = [];
  for (const ident of row.hdIdents) {
    const n = parseIntOrNull(/^\d+/.exec(ident)?.[0]);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Index the pull on `TYC1-TYC2-TYC3`, the same key `tycho2Key` composes and
 *  the manifest's `tyc` cell carries. A Tycho entry SIMBAD holds no HD for is
 *  absent from the file, so `has(tyc) === false` is "SIMBAD attributes no HD
 *  here" and never "not asked" — the pull requests every TYC IV/25 and the
 *  manifest mention. */
export function parseSimbadTycHdTsv(text: string): Map<string, SimbadTycHdRow> {
  const out = new Map<string, SimbadTycHdRow>();
  for (const { cells, idx } of dataRows(text, COLUMNS, LABEL, REFRESH_HINT)) {
    const tyc = nonEmpty(cells[idx.tyc]);
    const oid = parseIntOrNull(cells[idx.simbad_oid]);
    const hd = nonEmpty(cells[idx.hd]);
    if (tyc === null || oid === null || hd === null) continue;
    out.set(tyc, {
      hdIdents: hd.split('|').map((s) => s.trim()).filter((s) => s.length > 0),
      simbadOid: oid,
      mainId: nonEmpty(cells[idx.simbad_main_id]),
    });
  }
  return out;
}
