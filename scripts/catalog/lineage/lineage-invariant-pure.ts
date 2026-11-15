// Invariant queries over a stage's lineage lines: a code that must not appear, less its declared exceptions. See README.md#invariants.

import type { Check } from '../../util/emit-artifacts';
import {
  decodeLineageLine, lineageLineCode, lineageLineParams, parseParams, type LineageLine, type LineageParams,
  type LineageRow,
} from './lineage-row-pure';
import type { StageCodes } from './reason-codes/reason-codes-pure';

export type InvariantExceptions =
  | { readonly kind: 'rule'; readonly allows: (params: LineageParams) => boolean }
  | { readonly kind: 'named'; readonly param: string; readonly named: ReadonlyMap<string, string> };

export interface LineageInvariant {
  /** What holds, as one line; every violation report leads with it. */
  readonly holds: string;
  /** The full code whose rows break it. */
  readonly code: string;
  /** Asked once per distinct params text. */
  readonly exceptions: InvariantExceptions;
}

export const NO_EXCEPTIONS = (): boolean => false;

export function lineageInvariant<B extends string>(
  codes: StageCodes<B>, branch: B, holds: string, allows: (params: LineageParams) => boolean,
): LineageInvariant {
  return { holds, code: codes.code(branch), exceptions: { kind: 'rule', allows } };
}

export function namedExceptionsInvariant<B extends string>(
  codes: StageCodes<B>, branch: B, holds: string, param: string, named: ReadonlyMap<string, string>,
): LineageInvariant {
  return { holds, code: codes.code(branch), exceptions: { kind: 'named', param, named } };
}

export interface InvariantViolations {
  readonly invariant: LineageInvariant;
  readonly rows: readonly LineageRow[];
  /** Named exceptions no row carries, as `<key>\t<what it is>`. */
  readonly stale: readonly string[];
}

const RULE_MATCH = '';

/** The exception a row's params fall under (`RULE_MATCH` for a rule), or null when none does. */
function exceptionOf(exceptions: InvariantExceptions, params: LineageParams): string | null {
  if (exceptions.kind === 'rule') return exceptions.allows(params) ? RULE_MATCH : null;
  const value = params[exceptions.param];
  return value !== undefined && exceptions.named.has(value) ? value : null;
}

function staleExceptions(exceptions: InvariantExceptions, matched: ReadonlySet<string>): string[] {
  if (exceptions.kind === 'rule') return [];
  return [...exceptions.named].filter(([key]) => !matched.has(key)).map(([key, what]) => `${key}\t${what}`);
}

export function invariantViolations(
  invariants: readonly LineageInvariant[], lines: Iterable<LineageLine>,
): InvariantViolations[] {
  if (invariants.length === 0) return [];
  const byCode = new Map<string, LineageInvariant[]>();
  for (const inv of invariants) byCode.set(inv.code, [...byCode.get(inv.code) ?? [], inv]);
  const found = new Map<LineageInvariant, LineageRow[]>(invariants.map((inv) => [inv, []]));
  const matched = new Map<LineageInvariant, Set<string>>(invariants.map((inv) => [inv, new Set()]));
  const verdicts = new Map<LineageInvariant, Map<string, string | null>>(invariants.map((inv) => [inv, new Map()]));
  for (const line of lines) {
    const watching = byCode.get(lineageLineCode(line));
    if (watching === undefined) continue;
    const params = lineageLineParams(line);
    for (const inv of watching) {
      const asked = verdicts.get(inv)!;
      let exception = asked.get(params);
      if (exception === undefined) asked.set(params, exception = exceptionOf(inv.exceptions, parseParams(params)));
      if (exception === null) found.get(inv)!.push(decodeLineageLine(line));
      else matched.get(inv)!.add(exception);
    }
  }
  return invariants.map((invariant) => ({
    invariant, rows: found.get(invariant)!, stale: staleExceptions(invariant.exceptions, matched.get(invariant)!),
  }));
}

export const VIOLATIONS_LISTED = 20;

export function listedRows(lines: readonly string[]): string[] {
  const more = lines.length > VIOLATIONS_LISTED ? [`  … and ${lines.length - VIOLATIONS_LISTED} more`] : [];
  return [...lines.slice(0, VIOLATIONS_LISTED).map((l) => `  ${l}`), ...more];
}

export function invariantCheck(v: InvariantViolations): Check {
  const { invariant: { code, holds }, rows, stale } = v;
  if (rows.length === 0 && stale.length === 0) return { kind: 'pass', report: `invariant holds: ${holds}` };
  const broken = rows.length === 0 ? [] : [
    `invariant broken by ${rows.length} ${code} rows: ${holds}`,
    ...listedRows(rows.map((r) => `${r.key}\t${r.code}\t${r.params}`)),
  ];
  const lapsed = stale.length === 0 ? [] : [
    `${stale.length} declared ${code} exceptions no row carries any more; delete them: ${holds}`,
    ...listedRows(stale),
  ];
  return { kind: 'fail', message: [...broken, ...lapsed].join('\n') };
}
