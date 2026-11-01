// The upstream removal decisions behind each orphaned ledger key, joined on the origin key. See /scripts/catalog/lineage/README.md#sid-events.

import type { IdentityRow } from '../catalog/lineage/identity-pure';
import {
  decodeLineageLine, lineageLineKey, type LineageLine,
} from '../catalog/lineage/lineage-row-pure';
import type { CodeEffect } from '../catalog/lineage/reason-codes-pure';

export type RemovalEffect = Exclude<CodeEffect, 'none'>;

export interface OrphanCause {
  readonly origin: string;
  readonly code: string;
  readonly effect: RemovalEffect;
}

/** Each orphaned designation with the retire, park or merge outcomes recorded under every origin key whose identity row carries it; an empty list is an orphan no decision explains. */
export function orphanCauses(
  orphans: readonly string[],
  identity: Iterable<IdentityRow>,
  stageLines: Iterable<LineageLine>,
  effects: ReadonlyMap<string, CodeEffect>,
): Map<string, OrphanCause[]> {
  const wanted = new Set(orphans);
  const orphansByOrigin = new Map<string, string[]>();
  for (const row of identity) {
    for (const d of row.designations) {
      if (!wanted.has(d)) continue;
      const list = orphansByOrigin.get(row.key);
      if (list === undefined) orphansByOrigin.set(row.key, [d]);
      else if (!list.includes(d)) list.push(d);
    }
  }
  const causes = new Map<string, OrphanCause[]>(orphans.map((d) => [d, []]));
  for (const line of stageLines) {
    const designations = orphansByOrigin.get(lineageLineKey(line));
    if (designations === undefined) continue;
    const row = decodeLineageLine(line);
    if (row.role !== 'outcome') continue;
    const effect = effects.get(row.code);
    if (effect === undefined) throw new Error(`lineage code ${row.code} is declared by no stage`);
    if (effect === 'none') continue;
    for (const d of designations) causes.get(d)?.push({ origin: row.key, code: row.code, effect });
  }
  return causes;
}
