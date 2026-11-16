// The four-witness rule: which HD a record on a close pair ships. See README.md#which-witness-decides-a-close-pairs-hd.

import { hdNumbers, type SimbadTycHdRow } from './simbad-tyc-hd-parse';

export interface ClosePairWitnesses {
  /** IV/25's HD set for a Tycho entry, every row of an `n_hd=2` entry. */
  iv25Hds: (tyc: string) => ReadonlySet<number> | undefined;
  simbadTycHd: ReadonlyMap<string, SimbadTycHdRow>;
  /** SIMBAD's object (oid) for a Gaia DR3 source. */
  simbadObjectOf: (sourceId: string) => number | undefined;
}

/** `split`: the two TYC witnesses share no HD. `uncontested`: they share one,
 *  and either names the HD the record ships. Otherwise the row is contested,
 *  and the fourth witness — SIMBAD's object for the record's own source — says
 *  whether that HD is the record's (`move`), the TYC cell is the crossed one
 *  (`refuse`), or nothing (`source-silent`). */
/** IV/25's HD set per Tycho entry: an `n_hd=2` entry prints one row per HD. */
export function iv25HdSets(rows: Iterable<{ readonly tyc: string; readonly hd: number }>): Map<string, Set<number>> {
  const sets = new Map<string, Set<number>>();
  for (const { tyc, hd } of rows) {
    const at = sets.get(tyc);
    if (at === undefined) sets.set(tyc, new Set([hd]));
    else at.add(hd);
  }
  return sets;
}

export type ClosePairVerdict ='unanswered' | 'split' | 'uncontested' | 'move' | 'refuse' | 'source-silent';

export function closePairHdVerdict(
  record: { tyc: string | null; gaiaSourceId: string | null; hd: number | null },
  w: ClosePairWitnesses,
): ClosePairVerdict {
  const answer = record.tyc === null ? undefined : w.simbadTycHd.get(record.tyc);
  const printed = record.tyc === null ? undefined : w.iv25Hds(record.tyc);
  if (answer === undefined || printed === undefined) return 'unanswered';
  if (!hdNumbers(answer).some((hd) => printed.has(hd))) return 'split';
  if (record.hd !== null && (printed.has(record.hd) || hdNumbers(answer).includes(record.hd))) return 'uncontested';
  const ofSource = record.gaiaSourceId === null ? undefined : w.simbadObjectOf(record.gaiaSourceId);
  if (ofSource === undefined) return 'source-silent';
  return ofSource === answer.simbadOid ? 'move' : 'refuse';
}
