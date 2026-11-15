// Invariant queries over a stage's lineage lines: a code that must not appear, less its declared exceptions. See README.md#invariants.

import type { Check } from '../../util/emit-artifacts';
import {
  decodeLineageLine, lineageLineCode, lineageLineKey, lineageLineParams, parseParams, type LineageLine, type LineageParams,
  type LineageRow,
} from './lineage-row-pure';
import type { StageCodes } from './reason-codes/reason-codes-pure';

export type InvariantExceptions =
  | {
    readonly kind: 'rule';
    /** A function of the params alone: asked once per distinct params text. */
    readonly allows: (params: LineageParams) => boolean;
  }
  | { readonly kind: 'named'; readonly named: ReadonlyMap<string, string> };

export interface LineageInvariant {
  /** What holds, as one line; every violation report leads with it. */
  readonly holds: string;
  /** The full code whose rows break it. */
  readonly code: string;
  readonly exceptions: InvariantExceptions;
}

export const NO_EXCEPTIONS = (): boolean => false;

export function lineageInvariant<B extends string>(
  codes: StageCodes<B>, branch: B, holds: string, allows: (params: LineageParams) => boolean,
): LineageInvariant {
  return { holds, code: codes.code(branch), exceptions: { kind: 'rule', allows } };
}

export function namedExceptionsInvariant<B extends string>(
  codes: StageCodes<B>, branch: B, holds: string, named: ReadonlyMap<string, string>,
): LineageInvariant {
  return { holds, code: codes.code(branch), exceptions: { kind: 'named', named } };
}

export interface InvariantViolations {
  readonly invariant: LineageInvariant;
  readonly rows: readonly LineageRow[];
  readonly stale: readonly { readonly key: string; readonly what: string }[];
}

interface Watch {
  readonly code: string;
  readonly see: (line: LineageLine) => void;
  readonly result: () => InvariantViolations;
}

function watchRule(invariant: LineageInvariant, allows: (params: LineageParams) => boolean): Watch {
  const verdicts = new Map<string, boolean>();
  const rows: LineageRow[] = [];
  return {
    code: invariant.code,
    see: (line) => {
      const params = lineageLineParams(line);
      let allowed = verdicts.get(params);
      if (allowed === undefined) verdicts.set(params, allowed = allows(parseParams(params)));
      if (!allowed) rows.push(decodeLineageLine(line));
    },
    result: () => ({ invariant, rows, stale: [] }),
  };
}

function watchNamed(invariant: LineageInvariant, named: ReadonlyMap<string, string>): Watch {
  const matched = new Set<string>();
  const rows: LineageRow[] = [];
  return {
    code: invariant.code,
    see: (line) => {
      const key = lineageLineKey(line);
      if (named.has(key)) matched.add(key);
      else rows.push(decodeLineageLine(line));
    },
    result: () => ({
      invariant, rows,
      stale: [...named].filter(([key]) => !matched.has(key)).map(([key, what]) => ({ key, what })),
    }),
  };
}

function watch(invariant: LineageInvariant): Watch {
  const { exceptions } = invariant;
  return exceptions.kind === 'rule'
    ? watchRule(invariant, exceptions.allows)
    : watchNamed(invariant, exceptions.named);
}

export function invariantViolations(
  invariants: readonly LineageInvariant[], lines: Iterable<LineageLine>,
): InvariantViolations[] {
  if (invariants.length === 0) return [];
  const watches = invariants.map(watch);
  const byCode = new Map<string, Watch[]>();
  for (const w of watches) byCode.set(w.code, [...byCode.get(w.code) ?? [], w]);
  for (const line of lines) for (const w of byCode.get(lineageLineCode(line)) ?? []) w.see(line);
  return watches.map((w) => w.result());
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
    ...listedRows(stale.map(({ key, what }) => `${key}\t${what}`)),
  ];
  return { kind: 'fail', message: [...broken, ...lapsed].join('\n') };
}
