// The pair-review dispositions' columns and reader. See merge-derivation/README.md#disposing-a-queued-pair.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import { evidenceOf } from '../../util/tsv/cell-corrections-pure';
import type { PrintedVLookups } from '../photometry/v-magnitude-pure';
import type { WitnessVerdict } from './positional-witness/positional-witness-pure';

export const PAIR_DISPOSITION_COLUMNS = ['hip', 'entries', 'keep_entry', 'basis', 'evidence'] as const;
/** Meanings: merge-derivation/README.md#disposing-a-queued-pair. */
export const PAIR_DISPOSITION_BASES = ['tycho2_photometry', 'hip2_position', 'pair_component'] as const;
export type PairDispositionBasis = (typeof PAIR_DISPOSITION_BASES)[number];

export interface PairDisposition {
  hip: number;
  /** The queue row's entries, restated: a disposition taken over a different pair is stale. */
  entries: readonly string[];
  keepEntry: string;
  basis: PairDispositionBasis;
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
      basis: row.oneOf('basis', PAIR_DISPOSITION_BASES),
      evidence: evidenceOf(row, 'evidence', `HIP ${hip}`),
    });
  }
  return out;
}

/** What the build recomputes a pair disposition's basis from. */
export interface PairWitnesses {
  printedHipV: PrintedVLookups['printed_hip'];
  vtOf: (tyc: string) => number | null;
  positionWitness: (hip: number, entries: readonly string[]) => WitnessVerdict | null;
}

const separationsOf = (verdict: WitnessVerdict): string =>
  verdict.separations.map((s) => `${s.tyc} ${s.separationArcsec.toFixed(2)}"`).join(', ');

// see merge-derivation/README.md#disposing-a-queued-pair
export function requireWitnessedKeeps(
  dispositions: ReadonlyMap<number, PairDisposition>,
  witnesses: PairWitnesses,
): void {
  for (const d of dispositions.values()) {
    const fail = (why: string): never => {
      throw new Error(`pair-review disposition for HIP ${d.hip} rests on ${d.basis}, but ${why}`);
    };
    switch (d.basis) {
      case 'tycho2_photometry': {
        const hipV = witnesses.printedHipV(d.hip)?.vMag ?? fail('Hipparcos prints no V for it');
        const offsets = d.entries.map((tyc) => {
          const vt = witnesses.vtOf(tyc) ?? fail(`Tycho-2 entry ${tyc} prints no VT`);
          return { tyc, offset: Math.abs(vt - hipV) };
        }).sort((a, b) => a.offset - b.offset);
        if (offsets[0].tyc !== d.keepEntry || offsets[0].offset === offsets[1].offset) {
          fail(`${d.keepEntry} is not the one entry whose VT is nearest Hipparcos's V ${hipV}`);
        }
        const position = witnesses.positionWitness(d.hip, d.entries);
        if (position?.kind === 'match' && position.tyc !== d.keepEntry) {
          fail(`HIP2's position falls on ${position.tyc} alone (${separationsOf(position)}), which outranks photometry`);
        }
        break;
      }
      case 'hip2_position': {
        const verdict = witnesses.positionWitness(d.hip, d.entries)
          ?? fail('HIP2 gives it no position and proper motion to carry');
        if (verdict.kind !== 'match' || verdict.tyc !== d.keepEntry) {
          fail(`HIP2's position does not fall on ${d.keepEntry} alone (${separationsOf(verdict)})`);
        }
        break;
      }
      case 'pair_component':
        break;
      default: {
        const unhandled: never = d.basis;
        throw new Error(`unhandled pair-disposition basis ${String(unhandled)}`);
      }
    }
  }
}
