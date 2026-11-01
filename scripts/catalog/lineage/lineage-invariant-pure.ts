// Invariant queries over a stage's lineage lines: a code that must not appear, less its declared exceptions. See README.md#invariants.

import type { Check } from '../../util/emit-artifacts';
import {
  decodeLineageLine, lineageLineCode, paramsOf, type LineageLine, type LineageParams, type LineageRow,
} from './lineage-row-pure';
import type { StageCodes } from './reason-codes-pure';

export interface LineageInvariant {
  /** What holds, as one line; every violation report leads with it. */
  readonly holds: string;
  /** The full code whose rows break it. */
  readonly code: string;
  /** The declared exceptions: a row of `code` whose params this accepts is not a violation. */
  readonly allows: (params: LineageParams) => boolean;
}

export const NO_EXCEPTIONS = (): boolean => false;

export function lineageInvariant<B extends string>(
  codes: StageCodes<B>, branch: B, holds: string, allows: (params: LineageParams) => boolean,
): LineageInvariant {
  return { holds, code: codes.code(branch), allows };
}

export interface InvariantViolations {
  readonly invariant: LineageInvariant;
  readonly rows: readonly LineageRow[];
}

export function invariantViolations(
  invariants: readonly LineageInvariant[], lines: Iterable<LineageLine>,
): InvariantViolations[] {
  const byCode = new Map<string, LineageInvariant[]>();
  for (const inv of invariants) byCode.set(inv.code, [...byCode.get(inv.code) ?? [], inv]);
  const found = new Map<LineageInvariant, LineageRow[]>(invariants.map((inv) => [inv, []]));
  for (const line of lines) {
    const watching = byCode.get(lineageLineCode(line));
    if (watching === undefined) continue;
    const row = decodeLineageLine(line);
    const params = paramsOf(row);
    for (const inv of watching) if (!inv.allows(params)) found.get(inv)!.push(row);
  }
  return invariants.map((invariant) => ({ invariant, rows: found.get(invariant)! }));
}

export const VIOLATIONS_LISTED = 20;

export function invariantCheck(v: InvariantViolations): Check {
  if (v.rows.length === 0) return { kind: 'pass', report: `invariant holds: ${v.invariant.holds}` };
  const listed = v.rows.slice(0, VIOLATIONS_LISTED)
    .map((r) => `  ${r.key}\t${r.code}\t${r.params}`);
  const more = v.rows.length > VIOLATIONS_LISTED ? [`  … and ${v.rows.length - VIOLATIONS_LISTED} more`] : [];
  return {
    kind: 'fail',
    message: [
      `invariant broken by ${v.rows.length} ${v.invariant.code} rows: ${v.invariant.holds}`,
      ...listed, ...more,
    ].join('\n'),
  };
}
