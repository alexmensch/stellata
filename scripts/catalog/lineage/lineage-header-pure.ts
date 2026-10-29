// A stage's lineage header — what its files were built from — and whether a baseline may be diffed against. See README.md#run-to-run-diff.

export interface StageHeader {
  readonly stage: string;
  /** package.json's version: the build version the README keeps off every row. */
  readonly version: string;
  readonly commit: string;
  /** sha1 over the stage's input-file hashes. */
  readonly inputHash: string;
  readonly files: readonly string[];
}

export function headerText(header: StageHeader): string {
  return `${JSON.stringify(header, null, 2)}\n`;
}

export function parseHeader(text: string, file: string): StageHeader {
  const h = JSON.parse(text) as Partial<StageHeader>;
  const strings = ['stage', 'version', 'commit', 'inputHash'] as const;
  for (const field of strings) {
    if (typeof h[field] !== 'string' || h[field] === '') throw new Error(`${file}: header has no ${field}`);
  }
  if (!Array.isArray(h.files) || h.files.some((f) => typeof f !== 'string')) {
    throw new Error(`${file}: header has no file list`);
  }
  return h as StageHeader;
}

export type BaselineSource =
  | { readonly kind: 'checkout'; readonly header: StageHeader | null }
  | { readonly kind: 'against'; readonly dir: string }
  | { readonly kind: 'absent' };

export type BaselineVerdict =
  | { readonly kind: 'diff'; readonly why: 'merge-base' | 'accepted' | 'against' }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly message: string };

export const ACCEPT_ANY_BASELINE_FLAG = '--any-baseline';
export const AGAINST_FLAG = '--against';

export function judgeBaseline(
  source: BaselineSource, mergeBase: string | null, acceptAny: boolean,
): BaselineVerdict {
  if (source.kind === 'absent') return { kind: 'none' };
  if (source.kind === 'against') return { kind: 'diff', why: 'against' };
  const { header } = source;
  if (header !== null && mergeBase !== null && header.commit === mergeBase) {
    return { kind: 'diff', why: 'merge-base' };
  }
  if (acceptAny) return { kind: 'diff', why: 'accepted' };
  const built = header === null ? 'a baseline with no header' : `a baseline built at ${header.commit}`;
  const base = mergeBase === null ? 'no merge-base with origin/main' : `the merge-base ${mergeBase}`;
  return {
    kind: 'refused',
    message: `lineage diff refused: ${built}, not ${base}. Build the stage at the merge-base for a `
      + `matching baseline, or re-run with ${ACCEPT_ANY_BASELINE_FLAG} or ${AGAINST_FLAG} <dir>.`,
  };
}
