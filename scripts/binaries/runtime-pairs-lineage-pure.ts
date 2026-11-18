// Every multiples.tsv pair's fate in binaries.bin, keyed on its secondary row, as the `runtime-pairs` lineage stage. See README.md#runtime-pairs-lineage.

import { namedExceptionsInvariant, type LineageInvariant } from '../catalog/lineage/lineage-invariant-pure';
import { stageLineageLine, stageRow, type LineageLine } from '../catalog/lineage/lineage-row-pure';
import { outcomeCode, stageCodes } from '../catalog/lineage/reason-codes/reason-codes-pure';
import type { MultiplesPair } from './pairs-pure';
import type { PairFate } from './runtime-binaries-pure';
import { RUNTIME_PAIRS_LINEAGE } from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const RUNTIME_PAIRS_LINEAGE_BUDGET = { gzipBytes: 150_000, writeMs: 1_000 };

export const RUNTIME_PAIRS_CODES = stageCodes(RUNTIME_PAIRS_LINEAGE.stage, {
  emitted: outcomeCode('A pair emitted to the runtime orbit file as a record of its own.'),
  'dropped.primary-unresolved': outcomeCode('A pair whose primary resolves to no catalogue record.'),
  'dropped.secondary-unresolved': outcomeCode('A pair whose secondary resolves to no catalogue record.'),
  'dropped.degenerate-idx': outcomeCode('A pair whose two ends resolve to one catalogue record.'),
  'dropped.same-relation-alias': outcomeCode('A pair naming the same physical link as the kept pair of its (primary, secondary) records, at another granularity.'),
  'dropped.duplicate-relation': outcomeCode('A pair whose distinct star collapsed onto the records of another pair, the one kept: a missing minted slot.'),
});

const COLLAPSED_ROWS = new Map([
  ['multiples:05353-0523-Bb,Bc/Bc', 'θ¹ Ori Bc, onto Ba,Bc\'s records'],
  ['multiples:05353-0523-Bb,Bd/Bd', 'θ¹ Ori Bd, onto Ba,Bd\'s records'],
  ['multiples:07096+3828-A,BD/BD', '07096+3828 BD, onto A,BC\'s records: BC, BD and B share one Gaia source'],
]);

export const RUNTIME_PAIRS_INVARIANTS: readonly LineageInvariant[] = [
  namedExceptionsInvariant(
    RUNTIME_PAIRS_CODES, 'dropped.duplicate-relation',
    'no two distinct stars collapse onto one pair of records but the rows named (README.md#shared-slots-and-duplicate-relations)',
    COLLAPSED_ROWS,
  ),
];

function fateBranch(fate: PairFate) {
  return fate.kind === 'emitted' ? 'emitted' as const : `dropped.${fate.kind}` as const;
}

export function runtimePairsLineageLines(pairs: readonly MultiplesPair[], fates: readonly PairFate[]): LineageLine[] {
  return pairs.map((pair, i) => {
    const fate = fates[i];
    const evidence = 'kept' in fate ? [pairs[fate.kept].origin] : [];
    return stageLineageLine(RUNTIME_PAIRS_CODES, stageRow(RUNTIME_PAIRS_CODES, pair.origin, fateBranch(fate), {}, evidence));
  });
}
