// The pair-review dispositions' columns and reader. See merge-derivation/README.md#disposing-a-queued-pair.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import { evidenceOf } from '../../util/tsv/cell-corrections-pure';
import { BINDING_DISPOSITION_BASES, type BindingDispositionBasis } from './binding-review-dispositions-pure';

export const PAIR_DISPOSITION_COLUMNS = ['hip', 'entries', 'keep_entry', 'basis', 'evidence'] as const;

export interface PairDisposition {
  hip: number;
  /** The queue row's entries, restated: a disposition taken over a different pair is stale. */
  entries: readonly string[];
  keepEntry: string;
  basis: BindingDispositionBasis;
  evidence: string;
}

export function parsePairDispositionsTsv(text: string, from: Declared): Map<number, PairDisposition> {
  const out = new Map<number, PairDisposition>();
  for (const row of readTable({ ...from, columns: PAIR_DISPOSITION_COLUMNS, exact: true }, text)) {
    const hip = row.int('hip') ?? row.fail('no hip');
    if (out.has(hip)) row.fail(`duplicate HIP ${hip}`);
    const entries = row.requiredText('entries').split('|');
    const keepEntry = row.requiredText('keep_entry');
    if (!entries.includes(keepEntry)) row.fail(`HIP ${hip}: keep_entry ${keepEntry} is not on the pair ${entries.join('|')}`);
    out.set(hip, {
      hip, entries, keepEntry,
      basis: row.oneOf('basis', BINDING_DISPOSITION_BASES),
      evidence: evidenceOf(row, 'evidence', `HIP ${hip}`),
    });
  }
  return out;
}
