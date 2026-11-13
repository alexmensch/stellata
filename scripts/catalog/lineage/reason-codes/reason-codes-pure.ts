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

/** Generic over its status and whether a line carries it, so a stage's count-block keys are known to the compiler. */
export interface CodeDeclaration<St extends CodeStatus = CodeStatus, OnRows extends boolean = boolean> {
  readonly description: string;
  readonly effect: CodeEffect;
  /** The one role every line carrying the code is written in. */
  readonly role: LineageRole;
  readonly status: St;
  /** False for an admission code, which no line carries. */
  readonly onRows: OnRows;
}

export function outcomeCode(description: string, effect?: CodeEffect): CodeDeclaration<typeof LIVE, true>;
export function outcomeCode<St extends CodeStatus>(description: string, effect: CodeEffect, status: St): CodeDeclaration<St, true>;
export function outcomeCode(description: string, effect: CodeEffect = 'none', status: CodeStatus = LIVE): CodeDeclaration {
  return { description, effect, role: 'outcome', status, onRows: true };
}

export function refusalCode(description: string): CodeDeclaration<typeof LIVE, true> {
  return { description, effect: 'none', role: 'refused', status: LIVE, onRows: true };
}

/** A code that admits an object — a mint or reinstate event's code, a minted row's `route` — and is never a row's own code. Listed in the `outcome` role. */
export function admissionCode(description: string): CodeDeclaration<typeof LIVE, false> {
  return { description, effect: 'none', role: 'outcome', status: LIVE, onRows: false };
}

/** The branches of `D` a line can carry while live: a retired, historical or admission declaration is out. */
export type LiveBranch<D> = {
  [B in keyof D]: D[B] extends { readonly status: { readonly kind: 'retired' | 'historical' } } ? never
    : D[B] extends { readonly onRows: false } ? never : B
}[keyof D] & string;

export type StageCode<S extends string, B extends string> = `${S}.${B}`;

export interface StageCodes<B extends string, S extends string = string, L extends B = B> {
  readonly stage: S;
  readonly declarations: Readonly<Record<B, CodeDeclaration>>;
  /** Every full code, in declaration order. */
  readonly codes: readonly StageCode<S, B>[];
  /** The live codes a line can carry, in declaration order: the keys a stage's count block carries. */
  readonly live: readonly StageCode<S, L>[];
  code(branch: B): StageCode<S, B>;
  /** A live branch's code, typed as a key of the stage's count block; throws for a branch not declared live. */
  liveCode(branch: L): StageCode<S, L>;
  has(code: string): boolean;
  /** Whether a line may carry one of the stage's codes: false for an admission code; throws for any other code. */
  onRows(code: string): boolean;
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
  const declared = new Map<string, CodeDeclaration>();
  for (const [branch, d] of Object.entries<CodeDeclaration>(declarations)) {
    if (!NAME.test(branch)) throw new Error(`${stage}: code branch "${branch}" is not lowercase dotted words`);
    if (d.description.trim() === '' || /[\t\n\r]/.test(d.description)) {
      throw new Error(`${stage}.${branch}: a code needs a one-line description`);
    }
    full.set(branch, `${stage}.${branch as B}`);
    declared.set(`${stage}.${branch}`, d);
  }
  const declarationOf = (code: string): CodeDeclaration => {
    const d = declared.get(code);
    if (d === undefined) throw new Error(`${stage}: "${code}" is not a declared code`);
    return d;
  };
  const codes = [...full.values()];
  const known = new Set<string>(codes);
  const live = [...full]
    .filter(([branch]) => declarations[branch].status.kind === 'live' && declarations[branch].onRows)
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
    roleOf: (code) => declarationOf(code).role,
    onRows: (code) => declarationOf(code).onRows,
  };
}

export function codeEffects(stages: readonly StageCodes<string>[]): ReadonlyMap<string, CodeEffect> {
  return new Map(stages.flatMap((codes) => Object.entries(codes.declarations)
    .map(([branch, d]) => [codes.code(branch), d.effect] as const)));
}
