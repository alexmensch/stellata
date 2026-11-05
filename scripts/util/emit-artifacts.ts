// Writes a pipeline step's outputs. See README.md (emit-artifacts.ts entry).

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { REPO_ROOT } from './paths';
import {
  STAGING_SUFFIX, discardStaged, landStaged, writeStaged, type StagedContents,
} from './staged-write';

/** Outputs whose member set is whatever one run emits: members a run does not
 *  emit are deleted once the new set has landed. */
export interface OutputFamily {
  readonly dir: string;
  /** A pattern over member names, or every name a member may have. */
  readonly member: RegExp | readonly string[];
  readonly stamped: boolean;
}

export function isMemberName(family: OutputFamily, name: string): boolean {
  return family.member instanceof RegExp ? family.member.test(name) : family.member.includes(name);
}

export interface DeclaredOutputs<K extends string = string> {
  readonly files: Readonly<Record<K, string>>;
  readonly families: readonly OutputFamily[];
}

/** A relative path is repo-relative. */
export function declareOutputs<K extends string>(
  files: Record<K, string>,
  families: readonly OutputFamily[] = [],
): DeclaredOutputs<K> {
  return {
    files: Object.fromEntries(
      Object.entries<string>(files).map(([k, p]) => [k, resolve(REPO_ROOT, p)]),
    ) as Record<K, string>,
    families: families.map((f) => ({ ...f, dir: resolve(REPO_ROOT, f.dir) })),
  };
}

/** `refresh` replaces the check with a rewrite of its own baseline, which
 *  lands with the outputs or not at all. */
export type Check =
  | { readonly kind: 'pass'; readonly report?: string }
  | { readonly kind: 'fail'; readonly report?: string; readonly message: string }
  | { readonly kind: 'refresh'; readonly path: string; readonly text: string };

export type ArtifactContents = StagedContents;

interface EmissionBase<K extends string> {
  readonly outputs: DeclaredOutputs<K>;
  /** Family members, keyed by absolute path. */
  readonly members?: ReadonlyMap<string, ArtifactContents>;
  readonly checks?: readonly Check[];
}

export interface Emission<K extends string> extends EmissionBase<K> {
  readonly files: Readonly<Record<NoInfer<K>, ArtifactContents>>;
}

/** A run asked for some of the step's targets: it emits exactly `only`. */
export interface NarrowedEmission<K extends string, E extends K> extends EmissionBase<K> {
  readonly only: readonly E[];
  readonly files: Readonly<Record<E, ArtifactContents>>;
}

export class EmissionRefused extends Error {
  override name = 'EmissionRefused';
}

function assertDeclared(
  outputs: DeclaredOutputs,
  expected: readonly string[],
  keys: readonly string[],
  members: readonly string[],
): void {
  const undeclared = [
    ...expected.filter((k) => !(k in outputs.files)),
    ...keys.filter((k) => !(k in outputs.files)),
    ...members.filter((p) => !outputs.families.some((f) => isFamilyMember(f, p))),
  ];
  const unemitted = expected.filter((k) => !keys.includes(k));
  const unasked = keys.filter((k) => k in outputs.files && !expected.includes(k));
  undeclared.push(...unasked);
  if (undeclared.length > 0 || unemitted.length > 0) {
    throw new Error(
      'emitArtifacts: emitted files must equal the declared outputs'
        + (undeclared.length > 0 ? `; undeclared: ${undeclared.join(', ')}` : '')
        + (unemitted.length > 0 ? `; declared, not emitted: ${unemitted.join(', ')}` : ''),
    );
  }
}

export function isFamilyMember(family: OutputFamily, path: string): boolean {
  return dirname(path) === family.dir && isMemberName(family, basename(path));
}

function familyEntries(family: OutputFamily): string[] {
  return existsSync(family.dir) ? readdirSync(family.dir) : [];
}

/** The family's members on disk, absolute. */
export function familyMembers(family: OutputFamily): string[] {
  return familyEntries(family).filter((name) => isMemberName(family, name)).map((name) => resolve(family.dir, name));
}

/** The members on disk of the families a stamp records. */
export function stampedMembers(families: readonly OutputFamily[]): string[] {
  return families.filter((f) => f.stamped).flatMap(familyMembers);
}

export function sweepStaged(outputs: DeclaredOutputs, extra: readonly string[] = []): void {
  for (const p of [...Object.values<string>(outputs.files), ...extra]) discardStaged(p);
  for (const family of outputs.families) {
    for (const name of familyEntries(family)) {
      if (name.endsWith(STAGING_SUFFIX) && isMemberName(family, name.slice(0, -STAGING_SUFFIX.length))) {
        rmSync(resolve(family.dir, name), { force: true });
      }
    }
  }
}

export function emitArtifacts<K extends string>(emission: Emission<K>): void;
export function emitArtifacts<K extends string, E extends K>(emission: NarrowedEmission<K, E>): void;
export function emitArtifacts<K extends string>(
  emission: Emission<K> | NarrowedEmission<K, K>,
): void {
  const { outputs, checks = [] } = emission;
  const keyed = Object.entries<ArtifactContents>(emission.files);
  const members = [...(emission.members ?? new Map())].map(([p, c]) => [resolve(p), c] as const);
  const expected = 'only' in emission ? emission.only : Object.keys(outputs.files);
  assertDeclared(outputs, expected, keyed.map(([k]) => k), members.map(([p]) => p));
  const declared = keyed.map(([k, c]) => [outputs.files[k as K], c] as const);
  const files = new Map<string, ArtifactContents>([...declared, ...members]);

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
    for (const [path, contents] of staged) writeStaged(path, contents);
  } catch (err) {
    sweepStaged(outputs, [...staged.keys()]);
    throw err;
  }
  for (const path of staged.keys()) landStaged(path);

  for (const family of outputs.families) {
    for (const path of familyMembers(family)) {
      if (!files.has(path)) rmSync(path);
    }
  }
  for (const r of refreshes) console.log(`Updated ${r.path}`);
}

export async function emitEach<K extends string>(
  outputs: DeclaredOutputs<K>,
  keys: readonly K[],
  produce: (key: K) => Promise<{ contents: ArtifactContents; checks?: readonly Check[] }>,
): Promise<void> {
  const refused: K[] = [];
  for (const key of keys) {
    try {
      const { contents, checks } = await produce(key);
      emitArtifacts({ outputs, only: [key], files: { [key]: contents } as Record<K, ArtifactContents>, checks });
    } catch (err) {
      console.error(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      refused.push(key);
    }
  }
  if (refused.length > 0) {
    throw new EmissionRefused(`refused ${refused.join(', ')}; every other target landed`);
  }
}

/** A manual step's `--describe` answer: its query, the services it may ask,
 *  and the upstream release, with no network call (`pipeline/freshness.ts`). */
export interface PullDescription {
  readonly query: string;
  readonly services: readonly string[];
  readonly release?: string;
}

export function runStep(main: () => void | Promise<void>, describe?: () => PullDescription): void {
  if (describe && process.argv.includes('--describe')) {
    console.log(JSON.stringify(describe()));
    return;
  }
  Promise.resolve().then(main).catch((err: unknown) => {
    console.error(err instanceof EmissionRefused ? err.message : err);
    process.exit(1);
  });
}
