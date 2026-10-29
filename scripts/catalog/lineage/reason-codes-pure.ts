// Reason codes: each stage declares its own, closed and append-only; the committed list is generated from them. See README.md#reason-codes--closed-append-only-generated.

/** What a removal or re-bind does to the record's SID; `none` for every other code. */
export const CODE_EFFECTS = ['retire', 'park', 'merge', 'none'] as const;
export type CodeEffect = (typeof CODE_EFFECTS)[number];

export type CodeStatus =
  | { readonly kind: 'live' }
  | { readonly kind: 'retired'; readonly retiredIn: string }
  | { readonly kind: 'historical' };

export const LIVE: CodeStatus = { kind: 'live' };

export interface CodeDeclaration {
  readonly description: string;
  readonly effect: CodeEffect;
  readonly status: CodeStatus;
}

export interface StageCodes<B extends string> {
  readonly stage: string;
  readonly declarations: Readonly<Record<B, CodeDeclaration>>;
  /** The full code, `<stage>.<branch>`. */
  code(branch: B): string;
  has(code: string): boolean;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export function stageCodes<B extends string>(
  stage: string, declarations: Record<B, CodeDeclaration>,
): StageCodes<B> {
  if (!NAME.test(stage) || stage.includes('.')) throw new Error(`lineage stage "${stage}" is not a lowercase word`);
  const full = new Set<string>();
  for (const [branch, d] of Object.entries<CodeDeclaration>(declarations)) {
    if (!NAME.test(branch)) throw new Error(`${stage}: code branch "${branch}" is not lowercase dotted words`);
    if (d.description.trim() === '' || /[\t\n\r]/.test(d.description)) {
      throw new Error(`${stage}.${branch}: a code needs a one-line description`);
    }
    full.add(`${stage}.${branch}`);
  }
  return {
    stage,
    declarations,
    code: (branch) => `${stage}.${branch}`,
    has: (code) => full.has(code),
  };
}
