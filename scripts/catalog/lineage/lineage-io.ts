// A stage's lineage on disk: where its files live, the rotation into the baseline, gzip, git provenance. See README.md#run-to-run-diff.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { fileHashes } from '../../util/build-stamp';
import type { ArtifactContents, OutputFamily } from '../../util/emit-artifacts';
import { headState, packageVersion } from '../../util/git-provenance';
import { REPO_ROOT } from '../../util/paths';
import { stepInputPaths } from '../../util/step-inputs';
import { escapeRegExp } from '../../util/escape-regexp';
import { identityRows, type IdentityRow } from './identity-pure';
import { lineageRows, type LineageRow } from './lineage-row-pure';
import { headerText, parseHeader, type HeaderRead, type StageHeader } from './lineage-header-pure';

export interface LineageLayout {
  readonly current: string;
  readonly previous: string;
  readonly diff: string;
}

export function lineageLayout(buildDir: string): LineageLayout {
  return {
    current: resolve(buildDir, 'lineage'),
    previous: resolve(buildDir, 'lineage.previous'),
    diff: resolve(buildDir, 'lineage-diff'),
  };
}

export const LINEAGE_LAYOUT = lineageLayout(resolve(REPO_ROOT, 'build'));

/** A stage's files by stem: `<stem>.tsv.gz` each, one `<stage>.header.json`. */
export interface StageLineageSpec<F extends string> {
  readonly stage: string;
  readonly files: readonly F[];
  /** The stem holding identity rows for the records the stage founds. */
  readonly identity?: F;
}

export type StageOutputKey<F extends string> = `lineage:${F}` | 'lineage:header';

const fileName = (stem: string): string => `${stem}.tsv.gz`;
const headerName = (stage: string): string => `${stage}.header.json`;

function stageNames<F extends string>(spec: StageLineageSpec<F>): string[] {
  return [...spec.files.map(fileName), headerName(spec.stage)];
}

/** The stage's current files, as `declareOutputs` keys. */
export function stageOutputFiles<F extends string>(
  layout: LineageLayout, spec: StageLineageSpec<F>,
): Record<StageOutputKey<F>, string> {
  const files = Object.fromEntries(
    spec.files.map((f) => [`lineage:${f}`, resolve(layout.current, fileName(f))]),
  ) as Record<StageOutputKey<F>, string>;
  files['lineage:header'] = resolve(layout.current, headerName(spec.stage));
  return files;
}

function exactly(names: readonly string[]): RegExp {
  return new RegExp(`^(?:${names.map(escapeRegExp).join('|')})$`);
}

/** The baseline copies and the stage diff: emitted when they exist, deleted
 *  when a run does not emit them, and no other stage's file ever matches. */
export function stageFamilies<F extends string>(
  layout: LineageLayout, spec: StageLineageSpec<F>,
): OutputFamily[] {
  return [
    { dir: layout.previous, member: exactly(stageNames(spec)) },
    { dir: layout.diff, member: exactly([stageDiffName(spec.stage)]) },
  ];
}

export function stageDiffName(stage: string): string {
  return `${stage}.tsv`;
}

/** The baseline as it lands in the same emission as the stage's new files:
 *  the current files, read now, when it rotates; the pinned merge-base copy,
 *  re-emitted as it is, when it does not — the family deletes any it omits. */
export function baselineMembers<F extends string>(
  layout: LineageLayout, spec: StageLineageSpec<F>, rotate: boolean,
): Map<string, Uint8Array> {
  const from = rotate ? layout.current : layout.previous;
  const members = new Map<string, Uint8Array>();
  for (const name of stageNames(spec)) {
    const path = resolve(from, name);
    if (existsSync(path)) members.set(resolve(layout.previous, name), readFileSync(path));
  }
  return members;
}

export function stageEmission<F extends string>(
  layout: LineageLayout,
  spec: StageLineageSpec<F>,
  texts: Readonly<Record<F, string>>,
  header: StageHeader,
  diff: string | null,
  rotate: boolean,
): { files: Record<StageOutputKey<F>, ArtifactContents>; members: Map<string, ArtifactContents> } {
  const files = Object.fromEntries(
    spec.files.map((f) => [`lineage:${f}`, gzipText(texts[f])]),
  ) as Record<StageOutputKey<F>, ArtifactContents>;
  files['lineage:header'] = headerText(header);
  const members = new Map<string, ArtifactContents>(baselineMembers(layout, spec, rotate));
  if (diff !== null) members.set(resolve(layout.diff, stageDiffName(spec.stage)), diff);
  return { files, members };
}

export function gzipText(text: string): Uint8Array {
  return gzipSync(text, { level: 1 });
}

export function readLineage(path: string): LineageRow[] {
  return [...lineageRows(gunzipSync(readFileSync(path)).toString('utf8'), path)];
}

export function readIdentity(path: string): IdentityRow[] {
  return [...identityRows(gunzipSync(readFileSync(path)).toString('utf8'), path)];
}

export function readStageHeader(dir: string, stage: string): HeaderRead {
  const path = resolve(dir, headerName(stage));
  if (!existsSync(path)) return { kind: 'missing' };
  try {
    return { kind: 'read', header: parseHeader(readFileSync(path, 'utf8'), path) };
  } catch (err) {
    return { kind: 'unreadable', reason: err instanceof Error ? err.message : String(err) };
  }
}

export function stageFile(dir: string, stem: string): string {
  return resolve(dir, fileName(stem));
}

export async function stageHeader<F extends string>(
  spec: StageLineageSpec<F>, script: string,
): Promise<StageHeader> {
  const hashes = fileHashes(await stepInputPaths(script));
  return {
    stage: spec.stage,
    version: packageVersion(),
    ...headState(),
    inputHash: createHash('sha1').update(JSON.stringify(hashes)).digest('hex'),
    files: spec.files.map(fileName),
  };
}
