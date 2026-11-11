// Reason codes: each stage declares its own, closed and append-only; the committed list is generated from them. See README.md.

import type { LineageRole } from '../lineage-row-pure';

/** What a removal or re-bind does to the record's SID; `none` for every other code. */
export const CODE_EFFECTS = ['retire', 'park', 'merge', 'none'] as const;
export type CodeEffect = (typeof CODE_EFFECTS)[number];

export type CodeStatus =
  | { readonly kind: 'live' }
  | { readonly kind: 'retired'; readonly retiredIn: string }
  | { readonly kind: 'historical' };

export const LIVE: CodeStatus = { kind: 'live' };
export const HISTORICAL: CodeStatus = { kind: 'historical' };

export interface CodeDeclaration {
  readonly description: string;
  readonly effect: CodeEffect;
  /** The one role every line carrying the code is written in. */
  readonly role: LineageRole;
  readonly status: CodeStatus;
}

export function outcomeCode(description: string, effect: CodeEffect = 'none', status: CodeStatus = LIVE): CodeDeclaration {
  return { description, effect, role: 'outcome', status };
}

export function refusalCode(description: string): CodeDeclaration {
  return { description, effect: 'none', role: 'refused', status: LIVE };
}

export type StageCode<S extends string, B extends string> = `${S}.${B}`;

export interface StageCodes<B extends string, S extends string = string> {
  readonly stage: S;
  readonly declarations: Readonly<Record<B, CodeDeclaration>>;
  /** Every full code, in declaration order. */
  readonly codes: readonly StageCode<S, B>[];
  code(branch: B): StageCode<S, B>;
  has(code: string): boolean;
  /** The declared role of one of the stage's codes; throws for any other code. */
  roleOf(code: string): LineageRole;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export function stageCodes<B extends string, S extends string = string>(
  stage: S, declarations: Record<B, CodeDeclaration>,
): StageCodes<B, S> {
  if (!NAME.test(stage) || stage.includes('.')) throw new Error(`lineage stage "${stage}" is not a lowercase word`);
  const full = new Map<string, StageCode<S, B>>();
  const roles = new Map<string, LineageRole>();
  for (const [branch, d] of Object.entries<CodeDeclaration>(declarations)) {
    if (!NAME.test(branch)) throw new Error(`${stage}: code branch "${branch}" is not lowercase dotted words`);
    if (d.description.trim() === '' || /[\t\n\r]/.test(d.description)) {
      throw new Error(`${stage}.${branch}: a code needs a one-line description`);
    }
    full.set(branch, `${stage}.${branch as B}`);
    roles.set(`${stage}.${branch}`, d.role);
  }
  const codes = [...full.values()];
  const known = new Set<string>(codes);
  return {
    stage,
    declarations,
    codes,
    code: (branch) => {
      const code = full.get(branch);
      if (code === undefined) throw new Error(`${stage}: "${branch}" is not a declared code branch`);
      return code;
    },
    has: (code) => known.has(code),
    roleOf: (code) => {
      const role = roles.get(code);
      if (role === undefined) throw new Error(`${stage}: "${code}" is not a declared code`);
      return role;
    },
  };
}

export function codeEffects(stages: readonly StageCodes<string>[]): ReadonlyMap<string, CodeEffect> {
  return new Map(stages.flatMap((codes) => Object.entries(codes.declarations)
    .map(([branch, d]) => [codes.code(branch), d.effect] as const)));
}
