// A stage's lineage on disk: the rotation into the baseline, gzip, git provenance. See README.md#run-to-run-diff.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { FileHashes } from '../../util/build-stamp';
import type { ArtifactContents } from '../../util/emit-artifacts';
import { headState, packageVersion } from '../../util/git-provenance';
import { identityRows, type IdentityRow } from './identity-pure';
import { lineageLines, lineageRows, type LineageLine, type LineageRow } from './lineage-row-pure';
import { headerText, parseHeader, type HeaderRead, type StageHeader } from './lineage-header-pure';
import {
  stageDiffName, stageFileName, stageHeaderName, stageNames, type LineageLayout, type StageLineageSpec,
  type StageOutputKey,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

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

export function stageEmission<F extends string, S extends string>(
  layout: LineageLayout,
  spec: StageLineageSpec<F, S>,
  texts: Readonly<Record<F, string | Uint8Array>>,
  header: StageHeader,
  diff: Uint8Array | null,
  rotate: boolean,
): { files: Record<StageOutputKey<F, S>, ArtifactContents>; members: Map<string, ArtifactContents> } {
  const files = Object.fromEntries(
    spec.files.map((f) => [`lineage:${f}`, gzipText(texts[f])]),
  ) as Record<StageOutputKey<F, S>, ArtifactContents>;
  files[`lineage:${spec.stage}.header`] = headerText(header);
  const members = new Map<string, ArtifactContents>(baselineMembers(layout, spec, rotate));
  if (diff !== null) members.set(resolve(layout.diff, stageDiffName(spec.stage)), diff);
  return { files, members };
}

export function gzipText(text: string | Uint8Array): Uint8Array {
  return gzipSync(text, { level: 1 });
}

export function readLineage(path: string): LineageRow[] {
  return [...lineageRows(gunzipSync(readFileSync(path)), path)];
}

/** A stage file's lines one at a time, for a reader that need not hold them all. */
export function streamLineage(path: string): Generator<LineageLine> {
  return lineageLines(gunzipSync(readFileSync(path)), path);
}

export function readIdentity(path: string): IdentityRow[] {
  return [...identityRows(gunzipSync(readFileSync(path)).toString('utf8'), path)];
}

export function readStageHeader(dir: string, stage: string): HeaderRead {
  const path = resolve(dir, stageHeaderName(stage));
  if (!existsSync(path)) return { kind: 'missing' };
  try {
    return { kind: 'read', header: parseHeader(readFileSync(path, 'utf8'), path) };
  } catch (err) {
    return { kind: 'unreadable', reason: err instanceof Error ? err.message : String(err) };
  }
}

export function stageHeader<F extends string>(
  spec: StageLineageSpec<F>, inputs: FileHashes,
): StageHeader {
  return {
    stage: spec.stage,
    version: packageVersion(),
    ...headState(),
    inputHash: createHash('sha1').update(JSON.stringify(inputs)).digest('hex'),
    files: spec.files.map(stageFileName),
  };
}
