// A stage's lineage on disk: where its files live, the rotation into the baseline, gzip, git provenance. See README.md#run-to-run-diff.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { fileHashes } from '../../util/build-stamp';
import type { ArtifactContents, OutputFamily } from '../../util/emit-artifacts';
import { PACKAGE_JSON, REPO_ROOT } from '../../util/paths';
import { stepInputPaths } from '../../util/step-inputs';
import { escapeRegExp } from '../../util/escape-regexp';
import { lineageRows, type LineageRow } from './lineage-row-pure';
import { headerText, parseHeader, type StageHeader } from './lineage-header-pure';

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

/** The stage's current files, read now, as the baseline copies that land in
 *  the same emission as their replacements. */
export function rotationMembers<F extends string>(
  layout: LineageLayout, spec: StageLineageSpec<F>,
): Map<string, Uint8Array> {
  const members = new Map<string, Uint8Array>();
  for (const name of stageNames(spec)) {
    const path = resolve(layout.current, name);
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
): { files: Record<StageOutputKey<F>, ArtifactContents>; members: Map<string, ArtifactContents> } {
  const files = Object.fromEntries(
    spec.files.map((f) => [`lineage:${f}`, gzipText(texts[f])]),
  ) as Record<StageOutputKey<F>, ArtifactContents>;
  files['lineage:header'] = headerText(header);
  const members = new Map<string, ArtifactContents>(rotationMembers(layout, spec));
  if (diff !== null) members.set(resolve(layout.diff, stageDiffName(spec.stage)), diff);
  return { files, members };
}

export function gzipText(text: string): Uint8Array {
  return gzipSync(text, { level: 1 });
}

export function readLineage(path: string): LineageRow[] {
  return [...lineageRows(gunzipSync(readFileSync(path)).toString('utf8'), path)];
}

export function readStageHeader(dir: string, stage: string): StageHeader | null {
  const path = resolve(dir, headerName(stage));
  return existsSync(path) ? parseHeader(readFileSync(path, 'utf8'), path) : null;
}

export function stageFile(dir: string, stem: string): string {
  return resolve(dir, fileName(stem));
}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function headCommit(): string {
  return git('rev-parse', 'HEAD');
}

export function mergeBaseWithMain(): string | null {
  try {
    return git('merge-base', 'HEAD', 'origin/main');
  } catch {
    return null;
  }
}

export function packageVersion(): string {
  return (JSON.parse(readFileSync(resolve(REPO_ROOT, PACKAGE_JSON), 'utf8')) as { version: string }).version;
}

export async function stageHeader<F extends string>(
  spec: StageLineageSpec<F>, script: string,
): Promise<StageHeader> {
  const hashes = fileHashes(await stepInputPaths(script));
  return {
    stage: spec.stage,
    version: packageVersion(),
    commit: headCommit(),
    inputHash: createHash('sha1').update(JSON.stringify(hashes)).digest('hex'),
    files: spec.files.map(fileName),
  };
}
