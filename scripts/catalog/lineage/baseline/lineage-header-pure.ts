// A stage's lineage header — what its files were built from — and whether a baseline may be diffed against. See README.md.

import type { FileHashes } from '../../../util/build-stamp';

export interface StageHeader {
  readonly stage: string;
  /** package.json's version: the build version the README keeps off every row. */
  readonly version: string;
  readonly commit: string;
  /** Uncommitted edits: `commit` then does not say what the files were built from. */
  readonly dirty: boolean;
  /** sha1 over the stage's input-file hashes. */
  readonly inputHash: string;
  /** Each stage file's name → sha1 of its bytes as written. */
  readonly files: Readonly<Record<string, string>>;
}

/** A header before its files are written. */
export type StageProvenance = Omit<StageHeader, 'files'>;

export function headerText(header: StageHeader): string {
  return `${JSON.stringify(header, null, 2)}\n`;
}

export function parseHeader(text: string, file: string): StageHeader {
  const h = JSON.parse(text) as Partial<StageHeader>;
  const strings = ['stage', 'version', 'commit', 'inputHash'] as const;
  for (const field of strings) {
    if (typeof h[field] !== 'string' || h[field] === '') throw new Error(`${file}: header has no ${field}`);
  }
  if (typeof h.dirty !== 'boolean') throw new Error(`${file}: header has no dirty flag`);
  const files: unknown = h.files;
  if (typeof files !== 'object' || files === null || Array.isArray(files)
    || Object.values(files).some((hash) => typeof hash !== 'string' || hash === '')) {
    throw new Error(`${file}: header has no file hashes`);
  }
  return h as StageHeader;
}

/** A header written by an older build may not parse; that is a baseline to
 *  refuse, never a failed build. */
export type HeaderRead =
  | {
    readonly kind: 'read';
    readonly header: StageHeader;
    /** The stage spec's files as they are on disk now: name → sha1, null when absent. */
    readonly onDisk: FileHashes;
  }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly reason: string };

export type BaselineSource =
  | { readonly kind: 'checkout'; readonly header: HeaderRead }
  | { readonly kind: 'against'; readonly dir: string }
  | { readonly kind: 'absent' };

export type BaselineVerdict =
  | { readonly kind: 'diff'; readonly why: MergeBaseMatch | 'accepted' | 'against' }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly message: string };

export const ACCEPT_ANY_BASELINE_FLAG = '--any-baseline';
export const AGAINST_FLAG = '--against';

type ReadHeader = Extract<HeaderRead, { kind: 'read' }>;

/** The stage's files whose bytes on disk are not the ones the header recorded, or that it does not name. */
export function mismatchedFiles(read: ReadHeader): string[] {
  return Object.keys(read.onDisk).filter((name) => read.onDisk[name] !== read.header.files[name]);
}

/** The stage's input hash over its input files as the merge-base holds them. */
export type InputHashAt =
  | { readonly kind: 'hashed'; readonly hash: string }
  | { readonly kind: 'unknown'; readonly reason: string };

export interface MergeBase {
  readonly commit: string;
  /** Evaluated only for a clean, intact header from another commit. */
  readonly inputHash: () => InputHashAt;
}

/** `merge-base`: built at it. `merge-base-inputs`: built at another commit from the inputs it holds. */
export type MergeBaseMatch = 'merge-base' | 'merge-base-inputs';

export function mergeBaseMatch(read: HeaderRead, mergeBase: MergeBase | null): MergeBaseMatch | null {
  if (read.kind !== 'read' || read.header.dirty || mergeBase === null || mismatchedFiles(read).length > 0) return null;
  if (read.header.commit === mergeBase.commit) return 'merge-base';
  const at = mergeBase.inputHash();
  return at.kind === 'hashed' && at.hash === read.header.inputHash ? 'merge-base-inputs' : null;
}

export interface BaselinePlan {
  readonly verdict: BaselineVerdict;
  /** Which directory the diff reads, when it runs. */
  readonly from: 'previous' | 'current' | 'against' | null;
    readonly rotate: boolean;
}

export function planBaseline(
  previous: HeaderRead, source: BaselineSource, mergeBase: MergeBase | null, acceptAny: boolean,
): BaselinePlan {
  const pinned = mergeBaseMatch(previous, mergeBase);
  if (source.kind === 'against') {
    return { verdict: { kind: 'diff', why: 'against' }, from: 'against', rotate: pinned === null };
  }
  if (pinned !== null) return { verdict: { kind: 'diff', why: pinned }, from: 'previous', rotate: false };
  const verdict = judgeBaseline(source, mergeBase, acceptAny);
  return { verdict, from: verdict.kind === 'diff' ? 'current' : null, rotate: true };
}

export function judgeBaseline(
  source: BaselineSource, mergeBase: MergeBase | null, acceptAny: boolean,
): BaselineVerdict {
  if (source.kind === 'absent') return { kind: 'none' };
  if (source.kind === 'against') return { kind: 'diff', why: 'against' };
  const read = source.header;
  const match = mergeBaseMatch(read, mergeBase);
  if (match !== null) return { kind: 'diff', why: match };
  if (acceptAny) return { kind: 'diff', why: 'accepted' };
  const built = read.kind === 'missing'
    ? 'a baseline with no header'
    : read.kind === 'unreadable'
      ? `a baseline whose header does not read (${read.reason})`
      : builtAt(read);
  const base = mergeBase === null
    ? 'no merge-base with origin/main'
    : `the merge-base ${mergeBase.commit}${read.kind === 'read' ? inputsClause(read, mergeBase) : ''}`;
  return {
    kind: 'refused',
    message: `lineage diff refused: ${built}, not ${base}. Build the stage at the merge-base for a `
      + `matching baseline, or re-run with ${ACCEPT_ANY_BASELINE_FLAG} or ${AGAINST_FLAG} <dir>.`,
  };
}

function builtAt(read: ReadHeader): string {
  const built = `built at ${read.header.commit}${read.header.dirty ? ' with uncommitted edits' : ''}`;
  const mismatched = mismatchedFiles(read);
  if (mismatched.length === 0) return `a baseline ${built}`;
  return `a baseline whose ${mismatched.join(', ')} ${mismatched.length === 1 ? 'is not the file' : 'are not the files'} `
    + `its header (${built}) recorded`;
}

function inputsClause(read: ReadHeader, mergeBase: MergeBase): string {
  if (read.header.dirty || mismatchedFiles(read).length > 0) return '';
  const at = mergeBase.inputHash();
  return at.kind === 'unknown'
    ? ` (its inputs could not be compared with the merge-base's: ${at.reason})`
    : ' or a build from the inputs it holds';
}
