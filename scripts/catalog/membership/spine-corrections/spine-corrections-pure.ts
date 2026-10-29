// The curated spine merge-decision corrections: their parse, and the spine as the manifest reads it once they apply. See README.md.

import type { Declared } from '../../../util/sources/source';
import { readTable } from '../../../util/tsv/table-pure';
import { applyCellSets, evidenceOf } from '../../../util/tsv/cell-corrections-pure';
import type { SpineRow } from '../../spine/inherited-spine-pure';
import { BINDING_REVIEW_KEY_COLUMNS, bindingReviewKey } from '../ledger-rows-pure';

/** The corrections file as its own messages name it. */
export const SPINE_CORRECTIONS_NAME = 'spine-corrections.tsv';
export const SPINE_CORRECTION_COLUMNS = [
  ...BINDING_REVIEW_KEY_COLUMNS, 'op', 'cell', 'value', 'evidence',
] as const;
export const SPINE_CORRECTION_OPS = ['set', 'fold'] as const;
export type SpineCorrectionOp = (typeof SPINE_CORRECTION_OPS)[number];
/** `tyc` alone — a curated exception to a LABEL belongs in
 *  `classic_id_overrides.tsv`, where the merge can see it. */
export const SPINE_CORRECTION_CELLS = ['tyc'] as const;
export type SpineCorrectionCell = (typeof SPINE_CORRECTION_CELLS)[number];
export type SpineCorrectionRow = Record<
  (typeof SPINE_CORRECTION_COLUMNS)[number], string
> & { op: SpineCorrectionOp };

export function parseSpineCorrectionsTsv(text: string, from: Declared): SpineCorrectionRow[] {
  const out: SpineCorrectionRow[] = [];
  for (const row of readTable({ ...from, columns: SPINE_CORRECTION_COLUMNS, comments: true }, text)) {
    const cells = row.cells();
    const op = row.oneOf('op', SPINE_CORRECTION_OPS);
    if (op === 'set' && !(SPINE_CORRECTION_CELLS as readonly string[]).includes(cells.cell)) {
      row.fail(
        `set may write ${SPINE_CORRECTION_CELLS.join(', ')}, not "${cells.cell}" — `
          + 'a label exception belongs in classic_id_overrides.tsv',
      );
    }
    if (BINDING_REVIEW_KEY_COLUMNS.every((c) => cells[c].trim() === '')) {
      row.fail(
        "row names no spine row — every key cell is empty, and the empty key is Sol's own, "
          + 'so a blank one corrects the Sun',
      );
    }
    evidenceOf(row, 'evidence', bindingReviewKey(cells));
    out.push({ ...cells, op });
  }
  return out;
}

/** The gate reads the first pair (it walks the file), the generator the
 *  first and third. */
export interface SpineFold {
  foldedRow: number;
  survivorRow: number;
  survivorKept: number;
}

/** `corrected` is every spine row with its cells fixed, in file order — the
 *  keys a disposition now joins on. `kept` drops the folded ones. */
export function applySpineCorrections(
  spine: readonly SpineRow[], corrections: readonly SpineCorrectionRow[],
): { corrected: SpineRow[]; kept: SpineRow[]; keptSpineIndex: number[]; folds: SpineFold[] } {
  const byKey = new Map<string, number>();
  spine.forEach((row, i) => byKey.set(bindingReviewKey(row), i));
  const resolve = (key: string, what: string): number => {
    const i = byKey.get(key);
    if (i === undefined) {
      throw new Error(`${SPINE_CORRECTIONS_NAME}: ${what} "${key}" matches no spine row`);
    }
    return i;
  };

  const rows = applyCellSets<SpineRow, SpineCorrectionCell>(
    spine,
    corrections.filter((c) => c.op === 'set')
      .map((c) => ({ key: bindingReviewKey(c), cell: c.cell as SpineCorrectionCell, value: c.value })),
    {
      file: SPINE_CORRECTIONS_NAME,
      target: 'spine',
      keyOf: bindingReviewKey,
      get: (row, cell) => row[cell],
      with: (row, cell, value) => ({ ...row, [cell]: value }),
    },
  );
  const foldedTo = new Map<number, number>();
  for (const c of corrections) {
    if (c.op !== 'fold') continue;
    const i = resolve(bindingReviewKey(c), 'row');
    const survivor = resolve(c.value, 'fold target');
    if (survivor === i) {
      throw new Error(`${SPINE_CORRECTIONS_NAME}: row ${bindingReviewKey(c)} folds onto itself`);
    }
    foldedTo.set(i, survivor);
  }
  for (const survivor of foldedTo.values()) {
    if (foldedTo.has(survivor)) {
      throw new Error(
        `${SPINE_CORRECTIONS_NAME}: a fold target is itself folded — fold both onto the survivor`,
      );
    }
  }

  const kept: SpineRow[] = [];
  const keptSpineIndex: number[] = [];
  const keptIndex = new Map<number, number>();
  rows.forEach((row, i) => {
    if (foldedTo.has(i)) return;
    keptIndex.set(i, kept.length);
    kept.push(row);
    keptSpineIndex.push(i);
  });
  const folds = [...foldedTo].map(([foldedRow, survivorRow]) => ({
    foldedRow, survivorRow, survivorKept: keptIndex.get(survivorRow)!,
  }));
  return { corrected: rows, kept, keptSpineIndex, folds };
}
