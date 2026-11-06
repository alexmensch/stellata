// Invariant queries over a stage's lineage lines: a code that must not appear, less its declared exceptions. See README.md#invariants.

import type { Check } from '../../util/emit-artifacts';
import {
  decodeLineageLine, lineageLineCode, lineageLineParams, parseParams, type LineageLine, type LineageParams,
  type LineageRow,
} from './lineage-row-pure';
import type { StageCodes } from './reason-codes-pure';

export interface LineageInvariant {
  /** What holds, as one line; every violation report leads with it. */
  readonly holds: string;
  /** The full code whose rows break it. */
  readonly code: string;
  /** The declared exceptions: a row of `code` whose params this accepts is not a violation.
   *  A function of the params alone: it is asked once per distinct params text. */
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
  if (invariants.length === 0) return [];
  const byCode = new Map<string, LineageInvariant[]>();
  for (const inv of invariants) byCode.set(inv.code, [...byCode.get(inv.code) ?? [], inv]);
  const found = new Map<LineageInvariant, LineageRow[]>(invariants.map((inv) => [inv, []]));
  const verdicts = new Map<LineageInvariant, Map<string, boolean>>(invariants.map((inv) => [inv, new Map()]));
  for (const line of lines) {
    const watching = byCode.get(lineageLineCode(line));
    if (watching === undefined) continue;
    const params = lineageLineParams(line);
    for (const inv of watching) {
      const asked = verdicts.get(inv)!;
      let allowed = asked.get(params);
      if (allowed === undefined) asked.set(params, allowed = inv.allows(parseParams(params)));
      if (!allowed) found.get(inv)!.push(decodeLineageLine(line));
    }
  }
  return invariants.map((invariant) => ({ invariant, rows: found.get(invariant)! }));
}

export const VIOLATIONS_LISTED = 20;

export function listedRows(lines: readonly string[]): string[] {
  const more = lines.length > VIOLATIONS_LISTED ? [`  … and ${lines.length - VIOLATIONS_LISTED} more`] : [];
  return [...lines.slice(0, VIOLATIONS_LISTED).map((l) => `  ${l}`), ...more];
}

export function invariantCheck(v: InvariantViolations): Check {
  if (v.rows.length === 0) return { kind: 'pass', report: `invariant holds: ${v.invariant.holds}` };
  return {
    kind: 'fail',
    message: [
      `invariant broken by ${v.rows.length} ${v.invariant.code} rows: ${v.invariant.holds}`,
      ...listedRows(v.rows.map((r) => `${r.key}\t${r.code}\t${r.params}`)),
    ].join('\n'),
  };
}
