// Reason codes: each stage declares its own, closed and append-only; the committed list is generated from them. See README.md.

import type { LineageRole } from '../lineage-row-pure';

/** What a removal or re-bind does to the record's SID; `none` for every other code. */
export const CODE_EFFECTS = ['retire', 'park', 'merge', 'none'] as const;
export type CodeEffect = (typeof CODE_EFFECTS)[number];

export type CodeStatus =
  | { readonly kind: 'live' }
  | { readonly kind: 'retired'; readonly retiredIn: string }
  | { readonly kind: 'historical' };

export const LIVE = { kind: 'live' } as const satisfies CodeStatus;
export const HISTORICAL = { kind: 'historical' } as const satisfies CodeStatus;

export function retired(retiredIn: string): Extract<CodeStatus, { kind: 'retired' }> {
  return { kind: 'retired', retiredIn };
}

/** Generic over its status, so a stage's live codes are known to the compiler. */
export interface CodeDeclaration<St extends CodeStatus = CodeStatus> {
  readonly description: string;
  readonly effect: CodeEffect;
  /** The one role every line carrying the code is written in. */
  readonly role: LineageRole;
  readonly status: St;
}

export function outcomeCode(description: string, effect?: CodeEffect): CodeDeclaration<typeof LIVE>;
export function outcomeCode<St extends CodeStatus>(description: string, effect: CodeEffect, status: St): CodeDeclaration<St>;
export function outcomeCode(description: string, effect: CodeEffect = 'none', status: CodeStatus = LIVE): CodeDeclaration {
  return { description, effect, role: 'outcome', status };
}

export function refusalCode(description: string): CodeDeclaration<typeof LIVE> {
  return { description, effect: 'none', role: 'refused', status: LIVE };
}

/** The branches of `D` whose status is live: a retired or historical declaration is out. */
export type LiveBranch<D> = {
  [B in keyof D]: D[B] extends { readonly status: { readonly kind: 'retired' | 'historical' } } ? never : B
}[keyof D] & string;

export type StageCode<S extends string, B extends string> = `${S}.${B}`;

export interface StageCodes<B extends string, S extends string = string, L extends B = B> {
  readonly stage: S;
  readonly declarations: Readonly<Record<B, CodeDeclaration>>;
  /** Every full code, in declaration order. */
  readonly codes: readonly StageCode<S, B>[];
  /** The live codes, in declaration order: the keys a stage's count block carries. */
  readonly live: readonly StageCode<S, L>[];
  code(branch: B): StageCode<S, B>;
  /** A live branch's code, typed as a key of the stage's count block; throws for a branch not declared live. */
  liveCode(branch: L): StageCode<S, L>;
  has(code: string): boolean;
  /** The declared role of one of the stage's codes; throws for any other code. */
  roleOf(code: string): LineageRole;
}

/** The live branches of a stage's codes. */
export type LiveBranchOf<C> = C extends StageCodes<string, string, infer L> ? L : never;

/** A count block read by live branch: `codeCount(codes, counts)('v.none')`. */
export function codeCount<B extends string, S extends string, L extends B>(
  codes: StageCodes<B, S, L>, counts: Readonly<Record<StageCode<S, NoInfer<L>>, number>>,
): (branch: L) => number {
  return (branch) => counts[codes.liveCode(branch)];
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export function stageCodes<D extends Record<string, CodeDeclaration>, S extends string = string>(
  stage: S, declarations: D,
): StageCodes<keyof D & string, S, LiveBranch<D>> {
  type B = keyof D & string;
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
  const live = [...full]
    .filter(([branch]) => declarations[branch].status.kind === 'live')
    .map(([, code]) => code as StageCode<S, LiveBranch<D>>);
  const liveSet = new Set<string>(live);
  return {
    stage,
    declarations,
    codes,
    live,
    code: (branch) => {
      const code = full.get(branch);
      if (code === undefined) throw new Error(`${stage}: "${branch}" is not a declared code branch`);
      return code;
    },
    liveCode: (branch) => {
      const code = full.get(branch);
      if (code === undefined || !liveSet.has(code)) throw new Error(`${stage}: "${branch}" is not a live code branch`);
      return code as StageCode<S, LiveBranch<D>>;
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
