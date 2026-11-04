// The one data/ → public/ mirror: a step that copies the files its output declaration names. See README.md.

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { claims, claimsOf } from '../pipeline/step-table/step-table-pure';
import { emitArtifacts, isMemberName, type ArtifactContents, type DeclaredOutputs } from './emit-artifacts';
import { REPO_ROOT } from './paths';
import { defineFolder, type Declared, type Source } from './sources/source';

export interface MirroredFolder {
  readonly files: readonly Declared[];
  readonly outputs: DeclaredOutputs;
}

export interface MirrorSourceSpec {
  /** Repo-relative folder; every file in it (and in `flattenSubDirs`) the outputs name is a member. */
  readonly dir: string;
  readonly hint: string;
  readonly outputs: DeclaredOutputs;
  /** Subfolders of `dir` whose files land flat beside the rest. */
  readonly flattenSubDirs?: readonly string[];
}

/** Whether a file of this name is a declared output: a declared file's name or a family member's. */
export function declaresName(outputs: DeclaredOutputs, name: string): boolean {
  return Object.values<string>(outputs.files).some((path) => basename(path) === name)
    || outputs.families.some((family) => isMemberName(family, name));
}

export function mirrorSource(spec: MirrorSourceSpec): Source<MirroredFolder> {
  return defineFolder({
    dir: spec.dir,
    hint: spec.hint,
    include: (name) => declaresName(spec.outputs, name),
    subDirs: spec.flattenSubDirs,
    parse: (folder) => ({ files: folder.members, outputs: spec.outputs }),
  });
}

/** Absolute; `steps.test.ts` holds each family folder to its mirror alone. */
export function strays(outputs: DeclaredOutputs): string[] {
  const owned = claimsOf(outputs);
  return [...new Set(outputs.families.map((f) => f.dir))]
    .flatMap((dir) => (existsSync(dir) ? readdirSync(dir).map((name) => resolve(dir, name)) : []))
    .filter((path) => !claims(owned, path));
}

export function mirror({ files, outputs }: MirroredFolder): void {
  const sources = new Map(files.map(({ file }) => [basename(file), resolve(REPO_ROOT, file)]));
  if (sources.size !== files.length) {
    const names = files.map(({ file }) => basename(file));
    throw new Error(`mirror: two source files share a name: ${[...new Set(names.filter((n, i) => names.indexOf(n) !== i))].join(', ')}`);
  }
  const keyed = Object.entries<string>(outputs.files);
  const fileNames = new Set(keyed.map(([, path]) => basename(path)));
  const contents: Record<string, ArtifactContents> = Object.fromEntries(keyed
    .filter(([, path]) => sources.has(basename(path)))
    .map(([key, path]) => [key, { copyFrom: sources.get(basename(path))! }]));
  const members = new Map([...sources]
    .filter(([name]) => !fileNames.has(name))
    .map(([name, src]): [string, ArtifactContents] => [resolve(outputs.families.find((f) => isMemberName(f, name))!.dir, name), { copyFrom: src }]));

  emitArtifacts({ outputs, files: contents, members });
  for (const path of strays(outputs)) rmSync(path, { recursive: true });
  console.log(`mirrored ${sources.size} file(s)`);
}
