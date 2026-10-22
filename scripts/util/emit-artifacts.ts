// Writes a pipeline step's outputs. See README.md (emit-artifacts.ts entry).

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { writeStamp, type FileHashes } from './build-stamp';

/** Outputs whose member set is whatever one run emits: members a run does not
 *  emit are deleted once the new set has landed. */
export interface OutputFamily {
  readonly dir: string;
  readonly member: RegExp;
}

export interface DeclaredOutputs {
  readonly files: readonly string[];
  readonly families: readonly OutputFamily[];
}

export function declareOutputs(
  files: readonly string[],
  families: readonly OutputFamily[] = [],
): DeclaredOutputs {
  return {
    files: files.map((f) => resolve(f)),
    families: families.map((f) => ({ dir: resolve(f.dir), member: f.member })),
  };
}

/** `refresh` replaces the check with a rewrite of its own baseline, which
 *  lands with the outputs or not at all. */
export type Check =
  | { readonly kind: 'pass'; readonly report?: string }
  | { readonly kind: 'fail'; readonly report?: string; readonly message: string }
  | { readonly kind: 'refresh'; readonly path: string; readonly text: string };

export type ArtifactContents = string | Uint8Array;

export interface Emission {
  readonly outputs: DeclaredOutputs;
  readonly files: ReadonlyMap<string, ArtifactContents>;
  readonly checks?: readonly Check[];
  /** Written last, over exactly the emitted files. */
  readonly stamp?: { readonly path: string; readonly inputs: FileHashes };
}

export class EmissionRefused extends Error {
  override name = 'EmissionRefused';
}

export const STAGING_SUFFIX = '.staged';

function familyOf(outputs: DeclaredOutputs, path: string): OutputFamily | undefined {
  return outputs.families.find(
    (f) => dirname(path) === f.dir && f.member.test(basename(path)),
  );
}

function assertDeclared(outputs: DeclaredOutputs, paths: readonly string[]): void {
  const declared = new Set(outputs.files);
  const undeclared = paths.filter((p) => !declared.has(p) && familyOf(outputs, p) === undefined);
  const emitted = new Set(paths);
  const unemitted = outputs.files.filter((p) => !emitted.has(p));
  if (undeclared.length > 0 || unemitted.length > 0) {
    throw new Error(
      'emitArtifacts: emitted files must equal the declared outputs'
        + (undeclared.length > 0 ? `; undeclared: ${undeclared.join(', ')}` : '')
        + (unemitted.length > 0 ? `; declared, not emitted: ${unemitted.join(', ')}` : ''),
    );
  }
}

function familyEntries(family: OutputFamily): string[] {
  return existsSync(family.dir) ? readdirSync(family.dir) : [];
}

function sweepStaged(outputs: DeclaredOutputs, extra: readonly string[]): void {
  for (const p of [...outputs.files, ...extra]) rmSync(p + STAGING_SUFFIX, { force: true });
  for (const family of outputs.families) {
    for (const name of familyEntries(family)) {
      if (name.endsWith(STAGING_SUFFIX) && family.member.test(name.slice(0, -STAGING_SUFFIX.length))) {
        rmSync(resolve(family.dir, name), { force: true });
      }
    }
  }
}

export function emitArtifacts(emission: Emission): void {
  const { outputs, checks = [], stamp } = emission;
  const files = new Map([...emission.files].map(([p, c]) => [resolve(p), c] as const));
  assertDeclared(outputs, [...files.keys()]);

  for (const check of checks) {
    if (check.kind !== 'refresh' && check.report) console.log(check.report);
  }
  const failures = checks.flatMap((c) => (c.kind === 'fail' ? [c.message] : []));
  if (failures.length > 0) {
    for (const message of failures) console.error(message);
    throw new EmissionRefused(`${failures.length} check(s) failed; no output was written`);
  }

  const refreshes = checks.flatMap((c) => (c.kind === 'refresh' ? [c] : []));
  const staged = new Map<string, ArtifactContents>(files);
  for (const r of refreshes) staged.set(resolve(r.path), r.text);
  sweepStaged(outputs, [...staged.keys()]);

  try {
    for (const [path, contents] of staged) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path + STAGING_SUFFIX, contents);
    }
  } catch (err) {
    sweepStaged(outputs, [...staged.keys()]);
    throw err;
  }
  for (const path of staged.keys()) renameSync(path + STAGING_SUFFIX, path);

  for (const family of outputs.families) {
    for (const name of familyEntries(family)) {
      const path = resolve(family.dir, name);
      if (family.member.test(name) && !files.has(path)) rmSync(path);
    }
  }
  for (const r of refreshes) console.log(`Updated ${r.path}`);
  if (stamp) writeStamp(stamp.path, stamp.inputs, [...files.keys()]);
}
