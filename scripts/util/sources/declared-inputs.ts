// The sources and artifacts an import closure reaches: a step's data inputs, derived. See README.md#reached-means-read.

import { resolve } from 'node:path';

import type { Artifact } from '../tsv/artifact-pure';
import { REPO_ROOT } from '../paths';
import { listingFiles, type Source } from './source';

/** The only module names a `defineSource` / `defineArtifact` may live in. */
export const DECLARING_MODULE = /-(source|tsv)\.ts$/;

export type DeclaredValue = Source<unknown, unknown[], unknown> | Artifact<string, unknown, unknown>;

export interface DeclaredInput {
  /** Repo-relative path of the declaring module. */
  readonly module: string;
  /** The exported constant's name. */
  readonly name: string;
  readonly value: DeclaredValue;
}

function isDeclared(value: unknown): value is DeclaredValue {
  if (typeof value !== 'object' || value === null) return false;
  const { kind } = value as { kind?: unknown };
  return kind === 'source' || kind === 'artifact';
}

export async function declaredInputs(closure: Iterable<string>): Promise<DeclaredInput[]> {
  const out: DeclaredInput[] = [];
  for (const module of [...closure].filter((m) => DECLARING_MODULE.test(m)).sort()) {
    const exports = await import(resolve(REPO_ROOT, module)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(exports)) {
      if (isDeclared(value)) out.push({ module, name, value });
    }
  }
  return out;
}

/** Repo-relative files, sorted and distinct. */
export function declaredFiles(inputs: readonly DeclaredInput[]): string[] {
  const files = new Set<string>();
  for (const { value } of inputs) {
    for (const file of value.kind === 'source' ? listingFiles(value.files()) : [value.file]) files.add(file);
  }
  return [...files].sort();
}
