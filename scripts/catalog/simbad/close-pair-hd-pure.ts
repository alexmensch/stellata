// The four-witness rule: which HD a record on a close pair ships. See README.md#which-witness-decides-a-close-pairs-hd.

import { hdNumbers, type SimbadTycHdRow } from './simbad-tyc-hd-parse';

export interface ClosePairWitnesses {
  /** IV/25's HD set for a Tycho entry, every row of an `n_hd=2` entry. */
  iv25Hds: (tyc: string) => ReadonlySet<number> | undefined;
  simbadTycHd: ReadonlyMap<string, SimbadTycHdRow>;
  /** SIMBAD's object (oid) for a Gaia DR3 source. */
  simbadObjectOfSource: ReadonlyMap<string, number>;
}

/** `split`: the two TYC witnesses share no HD. `uncontested`: they share one,
 *  and either names the HD the record ships. Otherwise the row is contested,
 *  and the fourth witness — SIMBAD's object for the record's own source — says
 *  whether that HD is the record's (`move`), the TYC cell is the crossed one
 *  (`refuse`), or nothing (`source-silent`). */
export type ClosePairVerdict =
  | { readonly kind: 'unanswered' }
  | { readonly kind: 'split' }
  | { readonly kind: 'uncontested' }
  | { readonly kind: 'move'; readonly hds: readonly number[] }
  | { readonly kind: 'refuse' }
  | { readonly kind: 'source-silent' };
export type ClosePairVerdictKind = ClosePairVerdict['kind'];
export const CLOSE_PAIR_VERDICT_KINDS = [
  'unanswered', 'split', 'uncontested', 'move', 'refuse', 'source-silent',
] as const satisfies readonly ClosePairVerdictKind[];

export function closePairHdVerdict(
  record: { tyc: string | null; gaiaSourceId: string | null; hd: number | null },
  w: ClosePairWitnesses,
): ClosePairVerdict {
  const answer = record.tyc === null ? undefined : w.simbadTycHd.get(record.tyc);
  const printed = record.tyc === null ? undefined : w.iv25Hds(record.tyc);
  if (answer === undefined || printed === undefined) return { kind: 'unanswered' };
  const agreed = hdNumbers(answer).filter((hd) => printed.has(hd));
  if (agreed.length === 0) return { kind: 'split' };
  if (record.hd !== null && (printed.has(record.hd) || hdNumbers(answer).includes(record.hd))) {
    return { kind: 'uncontested' };
  }
  const ofSource = record.gaiaSourceId === null ? undefined : w.simbadObjectOfSource.get(record.gaiaSourceId);
  if (ofSource === undefined) return { kind: 'source-silent' };
  return ofSource === answer.simbadOid ? { kind: 'move', hds: agreed } : { kind: 'refuse' };
}
