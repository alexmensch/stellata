// Parser for data/simbad/simbad_tyc_hd.tsv, indexed on the full TYC — the
// HD-attribution witness independent of IV/25.
// See /data/simbad/README.md#the-tyc--hd-pull.

import type { Declared } from '../../util/sources/source';
import { intCell, readTable } from '../../util/tsv/table-pure';

const SIMBAD_TYC_HD_COLUMNS = ['tyc', 'simbad_oid', 'simbad_main_id', 'hd'] as const;

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
    const n = intCell(/^\d+/.exec(ident)?.[0]);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Index the pull on `TYC1-TYC2-TYC3`, the same key `tycho2Key` composes and
 *  the manifest's `tyc` cell carries. A Tycho entry SIMBAD holds no HD for is
 *  absent from the file, so `has(tyc) === false` is "SIMBAD attributes no HD
 *  here" and never "not asked" — the pull requests every TYC IV/25 and the
 *  manifest mention. */
export function parseSimbadTycHdTsv(text: string, from: Declared): Map<string, SimbadTycHdRow> {
  const out = new Map<string, SimbadTycHdRow>();
  for (const row of readTable({ ...from, columns: SIMBAD_TYC_HD_COLUMNS }, text)) {
    const tyc = row.text('tyc');
    const oid = row.int('simbad_oid');
    const hd = row.text('hd');
    if (tyc === null || oid === null || hd === null) continue;
    out.set(tyc, {
      hdIdents: hd.split('|').map((s) => s.trim()).filter((s) => s.length > 0),
      simbadOid: oid,
      mainId: row.text('simbad_main_id'),
    });
  }
  return out;
}
