// The sources and artifacts an import closure reaches, each classified by how the closure uses it. See README.md#reached-means-read.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { escapeRegExp } from '../escape-regexp';
import type { Artifact } from '../tsv/artifact-pure';
import { REPO_ROOT } from '../paths';
import { listingFiles, type Source } from './source';

/** The only module names a `defineSource` / `defineArtifact` may live in. */
export const DECLARING_MODULE = /-(source|tsv)\.ts$/;

export type DeclaredValue = Source<unknown, unknown[], unknown> | Artifact<string, unknown, unknown>;

export type DeclaredUse = 'read' | 'written' | 'both' | 'unused';

export interface DeclaredInput {
  /** Repo-relative path of the declaring module. */
  readonly module: string;
  /** The exported constant's name. */
  readonly name: string;
  readonly value: DeclaredValue;
  readonly use: DeclaredUse;
}

function isDeclared(value: unknown): value is DeclaredValue {
  if (typeof value !== 'object' || value === null) return false;
  const { kind } = value as { kind?: unknown };
  return kind === 'source' || kind === 'artifact';
}

function useOf(name: string, value: DeclaredValue, texts: readonly string[]): DeclaredUse {
  const n = escapeRegExp(name);
  const read = value.kind === 'source'
    ? new RegExp(`\\b${n}\\.read\\(`)
    : new RegExp(`\\b(readArtifact|artifactRows|artifactText|streamArtifact)\\(\\s*${n}\\b`);
  const written = value.kind === 'artifact' ? new RegExp(`\\b${n}\\.(serialize|encodeLine)\\(`) : null;
  const isRead = texts.some((t) => read.test(t));
  const isWritten = written !== null && texts.some((t) => written.test(t));
  if (isRead && isWritten) return 'both';
  if (isRead) return 'read';
  return isWritten ? 'written' : 'unused';
}

/** Classified by the read and write calls in the closure's other modules. */
export async function declaredInputs(closure: Iterable<string>): Promise<DeclaredInput[]> {
  const modules = [...closure].filter((m) => m.endsWith('.ts')).sort();
  const texts = new Map(modules.map((m) => [m, readFileSync(resolve(REPO_ROOT, m), 'utf8')]));
  const out: DeclaredInput[] = [];
  for (const module of modules.filter((m) => DECLARING_MODULE.test(m))) {
    const exports = await import(resolve(REPO_ROOT, module)) as Record<string, unknown>;
    const others = modules.filter((m) => m !== module).map((m) => texts.get(m)!);
    for (const [name, value] of Object.entries(exports)) {
      if (isDeclared(value)) out.push({ module, name, value, use: useOf(name, value, others) });
    }
  }
  return out;
}

export function isRead({ use }: DeclaredInput): boolean {
  return use === 'read' || use === 'both';
}

/** Repo-relative files, sorted and distinct. */
export function declaredFiles(inputs: readonly DeclaredInput[]): string[] {
  const files = new Set<string>();
  for (const { value } of inputs) {
    for (const file of value.kind === 'source' ? listingFiles(value.files()) : [value.file]) files.add(file);
  }
  return [...files].sort();
}
