// The pair-review dispositions' columns and reader. See merge-derivation/README.md#disposing-a-queued-pair.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import { evidenceOf } from '../../util/tsv/cell-corrections-pure';
import { BINDING_DISPOSITION_BASES, type BindingDispositionBasis } from './binding/binding-review-dispositions-pure';
import type { PrintedVLookups } from '../photometry/v-magnitude-pure';
import type { WitnessVerdict } from './positional-witness/positional-witness-pure';

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

// see merge-derivation/README.md#disposing-a-queued-pair
export function requirePhotometricKeeps(
  dispositions: ReadonlyMap<number, PairDisposition>,
  printedHipV: PrintedVLookups['printed_hip'],
  vtOf: (tyc: string) => number | null,
): void {
  for (const d of dispositions.values()) {
    if (d.basis !== 'tycho2_photometry') continue;
    const hipV = printedHipV(d.hip)?.vMag;
    if (hipV === undefined) throw new Error(`pair-review disposition for HIP ${d.hip} rests on tycho2_photometry, but Hipparcos prints no V for it`);
    const offsets = d.entries.map((tyc) => {
      const vt = vtOf(tyc);
      if (vt === null) throw new Error(`pair-review disposition for HIP ${d.hip} rests on tycho2_photometry, but Tycho-2 entry ${tyc} prints no VT`);
      return { tyc, offset: Math.abs(vt - hipV) };
    }).sort((a, b) => a.offset - b.offset);
    if (offsets[0].tyc !== d.keepEntry || offsets[0].offset === offsets[1].offset) {
      throw new Error(`pair-review disposition for HIP ${d.hip} rests on tycho2_photometry, but ${d.keepEntry} is not the one entry whose VT is nearest Hipparcos's V ${hipV}`);
    }
  }
}

// see merge-derivation/README.md#disposing-a-queued-pair
export function requirePositionalKeeps(
  dispositions: ReadonlyMap<number, PairDisposition>,
  positionWitness: (hip: number, entries: readonly string[]) => WitnessVerdict | null,
): void {
  for (const d of dispositions.values()) {
    if (d.basis !== 'hip2_position') continue;
    const verdict = positionWitness(d.hip, d.entries);
    if (verdict === null) throw new Error(`pair-review disposition for HIP ${d.hip} rests on hip2_position, but HIP2 gives it no position and proper motion to carry`);
    if (verdict.kind !== 'match' || verdict.tyc !== d.keepEntry) {
      const seps = verdict.separations.map((s) => `${s.tyc} ${s.separationArcsec.toFixed(2)}"`).join(', ');
      throw new Error(`pair-review disposition for HIP ${d.hip} rests on hip2_position, but HIP2's position does not fall on ${d.keepEntry} alone (${seps})`);
    }
  }
}
