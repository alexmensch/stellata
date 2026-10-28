// Declared data inputs and their reads. See README.md.

import { createReadStream, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import type { Artifact } from '../tsv/artifact-pure';
import { lfsContentReadable, REPO_ROOT } from '../paths';
import type { RowKey } from './row-ref-pure';

export interface Declared {
  /** Repo-relative. */
  readonly file: string;
  /** What to run when the file is missing or wrong: its refresh or build target. */
  readonly hint: string;
}

export interface SourceInput {
  readonly path: string;
  text(): string;
  bytes(): Buffer;
  lines(onLine: (line: string) => void): Promise<void>;
}

export interface SourceSpec<T, A extends unknown[], K> extends Declared {
  parse(input: SourceInput, ...args: A): T;
  members?(input: SourceInput): string[];
  readonly rowKey?: RowKey<K>;
}

export interface Source<T, A extends unknown[] = [], K = never> extends Declared {
  readonly kind: 'source';
  readonly rowKey?: RowKey<K>;
  read(...args: A): T;
  /** Every repo-relative file a `read` opens: the declared file, then its members. */
  files(): string[];
}

/** A missing file and an unsmudged LFS pointer are the same failure: the
 *  content is not on disk. */
export function openDeclared(declared: Declared): SourceInput {
  const path = resolve(REPO_ROOT, declared.file);
  if (!lfsContentReadable(path)) {
    throw new Error(
      `${declared.file} is missing or an unsmudged LFS pointer. `
      + `Confirm git LFS is pulled (\`git lfs pull\`); ${declared.hint}`,
    );
  }
  return {
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
  return {
    kind: 'source',
    file: spec.file,
    hint: spec.hint,
    rowKey: spec.rowKey,
    read: (...args) => {
      const input = openDeclared(spec);
      for (const member of spec.members?.(input) ?? []) openDeclared({ file: member, hint: spec.hint });
      return spec.parse(input, ...args);
    },
    files: () => (spec.members ? [spec.file, ...spec.members(openDeclared(spec))] : [spec.file]),
  };
}

export function readArtifact<C extends string, R, K>(artifact: Artifact<C, R, K>): R[] {
  return artifact.parse(openDeclared(artifact).text());
}

export async function streamArtifact<C extends string, R, K>(
  artifact: Artifact<C, R, K>,
  onRecord: (record: R) => void,
): Promise<void> {
  const reader = artifact.lineReader(onRecord);
  await openDeclared(artifact).lines(reader);
  reader.finish();
}

export function isSource(value: unknown): value is Source<unknown, unknown[], unknown> {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'source';
}
