// Declared data inputs and their reads. See README.md.

import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import type { Artifact } from '../tsv/artifact-pure';
import { lfsContentReadable, REPO_ROOT } from '../paths.ts';
import type { Declaration, RowKey, RowKeyOf } from './row-ref-pure';

export interface Declared {
  /** Repo-relative. */
  readonly file: string;
  /** What to run when the file is missing or wrong: its refresh or build target. */
  readonly hint: string;
}

export interface SourceInput extends Declared {
  readonly path: string;
  text(): string;
  bytes(): Buffer;
  lines(onLine: (line: string) => void): Promise<void>;
}

/** The declared file plus every member, each already presence-checked. */
export interface ParseInput extends SourceInput {
  readonly members: readonly SourceInput[];
  /** Throws for a file `members` did not list. */
  member(file: string): SourceInput;
}

export interface SourceSpec<T, A extends unknown[], K> extends Declared {
  parse(input: ParseInput, ...args: A): T;
  readonly members?: readonly Declared[] | ((input: SourceInput) => Declared[]);
  readonly rowKey?: RowKey<K>;
}

export type Listing =
  | { readonly kind: 'listed'; readonly files: readonly string[] }
  | { readonly kind: 'unlistable'; readonly file: string };

export interface Source<T, A extends unknown[] = [], K = never> extends Declared, Declaration {
  readonly kind: 'source';
  readonly rowKey: RowKeyOf<K>;
  read(...args: A): T;
  files(): Listing;
}

export function listingFiles(listing: Listing): readonly string[] {
  return listing.kind === 'listed' ? listing.files : [listing.file];
}

export function isReadable(declared: Declared): boolean {
  return lfsContentReadable(resolve(REPO_ROOT, declared.file));
}

/** A missing file and an unsmudged LFS pointer are the same failure: the
 *  content is not on disk. */
export function openDeclared(declared: Declared): SourceInput {
  const path = resolve(REPO_ROOT, declared.file);
  if (!isReadable(declared)) {
    throw new Error(
      `${declared.file} is missing or an unsmudged LFS pointer. `
      + `Confirm git LFS is pulled (\`git lfs pull\`); ${declared.hint}`,
    );
  }
  return {
    file: declared.file,
    hint: declared.hint,
    path,
    text: () => readFileSync(path, 'utf8'),
    bytes: () => readFileSync(path),
    async lines(onLine) {
      const lines = createInterface({
        input: createReadStream(path),
        crlfDelay: Number.POSITIVE_INFINITY,
      });
      for await (const line of lines) onLine(line);
    },
  };
}

export function defineSource<T, A extends unknown[] = [], K = never>(
  spec: SourceSpec<T, A, K>,
): Source<T, A, K> {
  const { members = [] } = spec;
  const memberList = (open: () => SourceInput): readonly Declared[] =>
    (typeof members === 'function' ? members(open()) : members);
  return {
    kind: 'source',
    file: spec.file,
    hint: spec.hint,
    rowKey: spec.rowKey as RowKeyOf<K>,
    read: (...args: A) => {
      const input = openDeclared(spec);
      const opened = memberList(() => input).map(openDeclared);
      const member = (file: string): SourceInput => {
        const hit = opened.find((m) => m.file === file);
        if (hit === undefined) throw new Error(`${spec.file}: ${file} is not a declared member`);
        return hit;
      };
      return spec.parse({ ...input, members: opened, member }, ...args);
    },
    files: () => {
      if (typeof members === 'function' && !isReadable(spec)) return { kind: 'unlistable', file: spec.file };
      return { kind: 'listed', files: [spec.file, ...memberList(() => openDeclared(spec)).map((m) => m.file)] };
    },
  } as Source<T, A, K>;
}

export interface FolderInput extends Declared {
  readonly path: string;
  readonly members: readonly SourceInput[];
}

export interface FolderSpec<T, A extends unknown[]> {
  /** Repo-relative folder. */
  readonly dir: string;
  readonly hint: string;
  /** Which entries of `dir` (and of each `subDirs` folder) are members. */
  include(name: string): boolean;
  readonly subDirs?: readonly string[];
  parse(folder: FolderInput, ...args: A): T;
}

export function defineFolder<T, A extends unknown[] = []>(spec: FolderSpec<T, A>): Source<T, A> {
  const folder: Declared = { file: spec.dir, hint: spec.hint };
  const present = (): boolean => statSync(resolve(REPO_ROOT, spec.dir), { throwIfNoEntry: false })?.isDirectory() === true;
  const listing = (): Declared[] => {
    if (!present()) throw new Error(`${spec.dir}/ is missing. ${spec.hint}`);
    return [spec.dir, ...(spec.subDirs ?? []).map((d) => `${spec.dir}/${d}`)].flatMap((dir) =>
      readdirSync(resolve(REPO_ROOT, dir))
        .sort()
        .filter((name) => spec.include(name) && statSync(resolve(REPO_ROOT, dir, name)).isFile())
        .map((name) => ({ file: `${dir}/${name}`, hint: spec.hint })));
  };
  return {
    kind: 'source',
    ...folder,
    read: (...args) => spec.parse(
      { ...folder, path: resolve(REPO_ROOT, spec.dir), members: listing().map(openDeclared) },
      ...args,
    ),
    files: () => (present()
      ? { kind: 'listed', files: listing().map((m) => m.file) }
      : { kind: 'unlistable', file: spec.dir }),
  } as Source<T, A>;
}

export function readArtifact<C extends string, R, K>(artifact: Artifact<C, R, K>): R[] {
  return artifact.parse(openDeclared(artifact).text());
}

export function artifactText<C extends string, R, K>(artifact: Artifact<C, R, K>): string {
  return openDeclared(artifact).text();
}

export function artifactRows<C extends string, R, K>(artifact: Artifact<C, R, K>): Generator<R> {
  return artifact.rows(openDeclared(artifact).text());
}

export async function streamArtifact<C extends string, R, K>(
  artifact: Artifact<C, R, K>,
  onRecord: (record: R) => void,
): Promise<void> {
  const reader = artifact.lineReader(onRecord);
  await openDeclared(artifact).lines(reader);
  reader.finish();
}
