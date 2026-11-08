// What the upstream stages' lineage says about ledger keys and admitted records, joined on the origin key. See README.md#sid-events.

import type { IdentityRow } from '../catalog/lineage/identity-pure';
import {
  decodeLineageLine, lineageLineCode, lineageLineKey, paramsOf, type LineageLine,
} from '../catalog/lineage/lineage-row-pure';
import type { CodeEffect } from '../catalog/lineage/reason-codes/reason-codes-pure';
import type { Causes, Decision } from './allocate-pure';

export interface IdentitySource {
  readonly stage: string;
  readonly rows: Iterable<IdentityRow>;
}

/** Each key with the retire, park and merge outcomes recorded under every origin whose identity row carries it, and the stages holding such a row; decisions come in `stageOrder`, then by origin. */
export function lineageCauses(
  keys: readonly string[],
  identity: readonly IdentitySource[],
  stageLines: Iterable<LineageLine>,
  effects: ReadonlyMap<string, CodeEffect>,
  stageOrder: readonly string[],
): Map<string, Causes> {
  const wanted = new Set(keys);
  const keysByOrigin = new Map<string, Set<string>>();
  const seenBy = new Map<string, Set<string>>(keys.map((k) => [k, new Set()]));
  for (const source of identity) {
    for (const row of source.rows) {
      for (const d of row.designations) {
        if (!wanted.has(d)) continue;
        seenBy.get(d)!.add(source.stage);
        const set = keysByOrigin.get(row.key);
        if (set === undefined) keysByOrigin.set(row.key, new Set([d]));
        else set.add(d);
      }
    }
  }
  const decisions = new Map<string, Decision[]>(keys.map((k) => [k, []]));
  for (const line of stageLines) {
    const carried = keysByOrigin.get(lineageLineKey(line));
    if (carried === undefined) continue;
    const row = decodeLineageLine(line);
    if (row.role !== 'outcome') continue;
    const effect = effects.get(row.code);
    if (effect === undefined) throw new Error(`lineage code ${row.code} is declared by no stage`);
    if (effect === 'none') continue;
    const into = effect !== 'merge' ? null : (paramsOf(row).record ?? (row.evidence.length === 1 ? row.evidence[0] : null));
    for (const d of carried) decisions.get(d)!.push({ stage: row.stage, origin: row.key, code: row.code, effect, into });
  }
  const rank = (stage: string): number => stageOrder.indexOf(stage);
  return new Map(keys.map((k) => [k, {
    decisions: decisions.get(k)!.sort((a, b) => rank(a.stage) - rank(b.stage) || (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0)),
    seenBy: stageOrder.filter((s) => seenBy.get(k)!.has(s)),
  }]));
}

/** The admitting code of each wanted origin: its first outcome row whose code `isAdmission` accepts. */
export function lineageAdmissions(
  origins: readonly string[],
  stageLines: Iterable<LineageLine>,
  isAdmission: (code: string) => boolean,
): Map<string, string> {
  const wanted = new Set(origins);
  const admissions = new Map<string, string>();
  for (const line of stageLines) {
    const key = lineageLineKey(line);
    if (!wanted.has(key) || admissions.has(key)) continue;
    const code = lineageLineCode(line);
    if (isAdmission(code) && decodeLineageLine(line).role === 'outcome') admissions.set(key, code);
  }
  return admissions;
}
