// The additions' items and their binding cells. See README.md#the-additions.

import type { Cns5Row } from '../classic-ids/classic-ids-parse';
import type { BindingCells } from './binding/binding-derivation-pure';
import type { SpineRow } from '../spine/inherited-spine-pure';
import {
  findAdditions,
  indexPrimaries,
  spineKeys,
  type HdAddition,
  type HipAddition,
  type PrimaryIndex,
  type PrimaryTables,
} from '../spine/primaries-audit-pure';

export type AdditionCohorts = { hd: HdAddition | null; hip: HipAddition | null; cns5: Cns5Row | null };

/** One primary's row the spine lacks, before the cohorts are merged: the same
 *  star reaches this list once per primary that names it. */
export interface AdditionCohortItem extends AdditionCohorts {
  key: string;
}

export function soleItem<K extends keyof AdditionCohorts>(
  items: readonly AdditionCohorts[], cohort: K,
): AdditionCohorts[K] | null {
  return items.find((i) => i[cohort] !== null)?.[cohort] ?? null;
}

export function cns5Gl(cns5: Cns5Row | null): string | null {
  return cns5 === null ? null : `GJ ${cns5.gj}${cns5.gjComp ?? ''}`;
}

/** The cells a group derives its binding from — the same three a spine row's
 *  derivation reads. */
export function additionCells(items: readonly AdditionCohorts[]): BindingCells {
  const hip = soleItem(items, 'hip');
  return {
    tyc: soleItem(items, 'hd')?.tyc ?? '',
    hip: hip === null ? '' : String(hip.hip),
    gl: cns5Gl(soleItem(items, 'cns5')) ?? '',
  };
}

export function additionCohortItems(
  tables: PrimaryTables, kept: readonly SpineRow[], idx: PrimaryIndex,
): AdditionCohortItem[] {
  const additions = findAdditions(tables, spineKeys(kept), idx);
  return [
    ...additions.hd.map((hd) => ({ key: `tyc:${hd.tyc}`, hd, hip: null, cns5: null })),
    ...additions.hip.map((hip) => ({ key: `hip:${hip.hip}`, hd: null, hip, cns5: null })),
    ...additions.cns5.newRecords.map((cns5) => ({
      key: `cns5:${cns5.cns5}`, hd: null, hip: null, cns5,
    })),
  ];
}

/** ../astrometry-request/README.md#the-request-is-a-union-and-why-that-is-not-a-compromise. */
export function additionItemCells(
  tables: PrimaryTables, kept: readonly SpineRow[],
): BindingCells[] {
  return additionCohortItems(tables, kept, indexPrimaries(tables)).map((i) => additionCells([i]));
}
