// A stage's lineage header — what its files were built from — and whether a baseline may be diffed against. See README.md.

import type { FileHashes } from '../../../util/build-stamp';
import type { HashesAt } from '../../../util/input-hashes-at';

export interface StageHeader {
  readonly stage: string;
  /** package.json's version: the build version the README keeps off every row. */
  readonly version: string;
  readonly commit: string;
  /** What the stage read: the runner's pre-run input map, path → hash. */
  readonly inputs: FileHashes;
  /** Each stage file's name → sha1 of its bytes as written. */
  readonly files: Readonly<Record<string, string>>;
}

/** A header before its files are written. */
export type StageProvenance = Omit<StageHeader, 'files'>;

export function headerText(header: StageHeader): string {
  return `${JSON.stringify(header, null, 2)}\n`;
}

const isHashMap = (value: unknown, allowNull: boolean): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.values(value).every((hash) => (typeof hash === 'string' && hash !== '') || (allowNull && hash === null));

export function parseHeader(text: string, file: string): StageHeader {
  const h = JSON.parse(text) as Partial<StageHeader>;
  const strings = ['stage', 'version', 'commit'] as const;
  for (const field of strings) {
    if (typeof h[field] !== 'string' || h[field] === '') throw new Error(`${file}: header has no ${field}`);
  }
  if (!isHashMap(h.inputs, true)) throw new Error(`${file}: header has no input map`);
  if (!isHashMap(h.files, false)) throw new Error(`${file}: header has no file hashes`);
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

/** `matched`: its input map is the base's. `accepted`: --any-baseline. */
export type DiffWhy = 'matched' | 'accepted' | 'against';

export type BaselineVerdict =
  | { readonly kind: 'diff'; readonly why: DiffWhy }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly message: string };

export const ACCEPT_ANY_BASELINE_FLAG = '--any-baseline';
export const AGAINST_FLAG = '--against';

type ReadHeader = Extract<HeaderRead, { kind: 'read' }>;

/** The stage's files whose bytes on disk are not the ones the header recorded, or that it does not name. */
export function mismatchedFiles(read: ReadHeader): string[] {
  return Object.keys(read.onDisk).filter((name) => read.onDisk[name] !== read.header.files[name]);
}

export type InputsAt = (commit: string, paths: () => readonly string[]) => HashesAt;

/** What a header's input map is compared with: see README.md#the-verdict--one-map-comparison. */
export type Base =
  | { readonly kind: 'fixed'; readonly commit: string; readonly paths: () => readonly string[] }
  | { readonly kind: 'recorded'; readonly inHistory: (commit: string) => boolean };

export interface BaselineContext {
  readonly base: Base;
  readonly inputsAt: InputsAt;
}

export function baseAt(
  head: { readonly onMainBranch: boolean; readonly commit: string }, mergeBase: string,
  inHistory: (commit: string) => boolean, branchPaths: () => readonly string[],
): Base {
  return head.onMainBranch && head.commit === mergeBase
    ? { kind: 'recorded', inHistory }
    : { kind: 'fixed', commit: mergeBase, paths: branchPaths };
}

type Comparison =
  | { readonly kind: 'match' }
  | { readonly kind: 'files'; readonly mismatched: readonly string[] }
  | { readonly kind: 'no-merge-base' }
  | { readonly kind: 'outside-history' }
  | { readonly kind: 'unknown'; readonly base: BaseAt; readonly reason: string }
  | { readonly kind: 'differs'; readonly base: BaseAt; readonly paths: readonly string[] };

interface BaseAt {
  readonly kind: Base['kind'];
  readonly commit: string;
}

/** An input a header does not name was not read, which matches one the commit does not hold. */
export function differingInputs(recorded: FileHashes, at: FileHashes, paths: readonly string[]): string[] {
  return paths.filter((path) => (recorded[path] ?? null) !== (at[path] ?? null));
}

function compare(read: ReadHeader, context: BaselineContext | null): Comparison {
  const mismatched = mismatchedFiles(read);
  if (mismatched.length > 0) return { kind: 'files', mismatched };
  if (context === null) return { kind: 'no-merge-base' };
  const { header } = read;
  const { base } = context;
  if (base.kind === 'recorded' && !base.inHistory(header.commit)) return { kind: 'outside-history' };
  const commit = base.kind === 'fixed' ? base.commit : header.commit;
  const at = context.inputsAt(
    commit, () => [...new Set([...Object.keys(header.inputs), ...(base.kind === 'fixed' ? base.paths() : [])])].sort(),
  );
  const named: BaseAt = { kind: base.kind, commit };
  if (at.kind === 'unknown') return { kind: 'unknown', base: named, reason: at.reason };
  const differing = differingInputs(header.inputs, at.hashes, Object.keys(at.hashes));
  return differing.length === 0 ? { kind: 'match' } : { kind: 'differs', base: named, paths: differing };
}

const matches = (read: HeaderRead, context: BaselineContext | null): read is ReadHeader =>
  read.kind === 'read' && compare(read, context).kind === 'match';

/** The file hashes of the first header whose inputs are the base's: what its files are there. */
export function acceptedFiles(
  headers: readonly HeaderRead[], context: BaselineContext,
): Readonly<Record<string, string>> | null {
  return headers.find((read): read is ReadHeader => matches(read, context))?.header.files ?? null;
}

export type BaselinePlan =
  | {
    readonly kind: 'diff';
    readonly why: DiffWhy;
    /** Which directory the diff reads. */
    readonly from: 'previous' | 'current' | 'against';
    readonly rotate: boolean;
  }
  | { readonly kind: 'none'; readonly rotate: true }
  | { readonly kind: 'refused'; readonly message: string; readonly rotate: true };

export function planBaseline(
  previous: HeaderRead, source: BaselineSource, context: BaselineContext | null, acceptAny: boolean,
): BaselinePlan {
  const pinned = context?.base.kind === 'fixed' && matches(previous, context);
  if (source.kind === 'against') return { kind: 'diff', why: 'against', from: 'against', rotate: !pinned };
  if (pinned) return { kind: 'diff', why: 'matched', from: 'previous', rotate: false };
  const verdict = judgeBaseline(source, context, acceptAny);
  return verdict.kind === 'diff' ? { ...verdict, from: 'current', rotate: true } : { ...verdict, rotate: true };
}

export function judgeBaseline(
  source: BaselineSource, context: BaselineContext | null, acceptAny: boolean,
): BaselineVerdict {
  if (source.kind === 'absent') return { kind: 'none' };
  if (source.kind === 'against') return { kind: 'diff', why: 'against' };
  const read = source.header;
  if (read.kind !== 'read') {
    if (acceptAny) return { kind: 'diff', why: 'accepted' };
    return refused(read.kind === 'missing'
      ? 'a baseline with no header'
      : `a baseline whose header does not read (${read.reason})`);
  }
  const comparison = compare(read, context);
  if (comparison.kind === 'match') return { kind: 'diff', why: 'matched' };
  if (acceptAny) return { kind: 'diff', why: 'accepted' };
  return refused(refusal(read.header.commit, comparison));
}

const refused = (why: string): BaselineVerdict => ({
  kind: 'refused',
  message: `lineage diff refused: ${why}. Build the stage at the merge-base for a matching baseline, or re-run `
    + `with ${ACCEPT_ANY_BASELINE_FLAG} or ${AGAINST_FLAG} <dir>.`,
});

function refusal(commit: string, comparison: Exclude<Comparison, { kind: 'match' }>): string {
  const built = `a baseline built at ${commit}`;
  switch (comparison.kind) {
    case 'files': {
      const { mismatched } = comparison;
      return `a baseline whose ${mismatched.join(', ')} ${mismatched.length === 1 ? 'is not the file' : 'are not the files'} `
        + `its header (built at ${commit}) recorded`;
    }
    case 'no-merge-base':
      return `${built}, and no merge-base with origin/main`;
    case 'outside-history':
      return `${built}, not a build from HEAD's history`;
    case 'unknown':
      return `${built}, whose inputs could not be compared with ${baseName(comparison.base)}'s: ${comparison.reason}`;
    case 'differs':
      return `${built}, whose inputs differ from ${baseName(comparison.base)}'s: ${comparison.paths.join(', ')}`;
  }
}

const baseName = ({ kind, commit }: BaseAt): string =>
  kind === 'fixed' ? `the merge-base ${commit}` : `its commit ${commit}`;
