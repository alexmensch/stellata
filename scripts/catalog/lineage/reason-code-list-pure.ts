// The committed reason-code list: generated from every stage's declarations, append-only against its merge-base copy. See README.md#reason-codes--closed-append-only-generated.

import type { CodeEffect, StageCodes } from './reason-codes-pure';
import { compareUtf8 } from './lineage-row-pure';

export const CODE_STATUSES = ['live', 'retired', 'historical'] as const;
export type CodeStatusName = (typeof CODE_STATUSES)[number];

export interface ReasonCodeEntry {
  readonly code: string;
  readonly stage: string;
  readonly effect: CodeEffect;
  readonly status: CodeStatusName;
  /** The version that retired it; empty unless retired. */
  readonly retiredIn: string;
  readonly firstVersion: string;
  readonly description: string;
}


/** A code already listed keeps the version it first shipped in; a new one
 *  takes `version`, the tree's own. */
export function reasonCodeList(
  stages: readonly StageCodes<string>[], committed: readonly ReasonCodeEntry[], version: string,
): ReasonCodeEntry[] {
  const shipped = new Map(committed.map((e) => [e.code, e.firstVersion]));
  const entries: ReasonCodeEntry[] = [];
  const seen = new Set<string>();
  for (const stage of stages) {
    for (const [branch, d] of Object.entries(stage.declarations)) {
      const code = stage.code(branch);
      if (seen.has(code)) throw new Error(`reason code ${code} is declared twice`);
      seen.add(code);
      entries.push({
        code,
        stage: stage.stage,
        effect: d.effect,
        status: d.status.kind,
        retiredIn: d.status.kind === 'retired' ? d.status.retiredIn : '',
        firstVersion: shipped.get(code) ?? version,
        description: d.description,
      });
    }
  }
  return entries.sort((a, b) => compareUtf8(a.code, b.code));
}

/** Every code the merge-base listed is still listed with the same stage,
 *  effect and description; only its status may move, live to retired. */
export function appendOnlyViolations(
  base: readonly ReasonCodeEntry[], current: readonly ReasonCodeEntry[],
): string[] {
  const now = new Map(current.map((e) => [e.code, e]));
  const out: string[] = [];
  for (const was of base) {
    const is = now.get(was.code);
    if (is === undefined) {
      out.push(`${was.code} was removed or renamed; mark it retired instead`);
      continue;
    }
    for (const field of ['stage', 'effect', 'description', 'firstVersion'] as const) {
      if (is[field] !== was[field]) out.push(`${was.code}: ${field} changed from "${was[field]}" to "${is[field]}"`);
    }
    if (is.status !== was.status && !(was.status === 'live' && is.status === 'retired')) {
      out.push(`${was.code}: status may only move live → retired, not ${was.status} → ${is.status}`);
    }
  }
  return out;
}
