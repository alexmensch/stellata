// Whether a step's record still matches the disk: one test for every kind. See README.md#freshness--one-mechanism.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  asStamp, changedSince, fileHashes, inputHashes, readStamp, readStampJson, recordedChanges,
  type FileHashes, type RecordedReads, type Stamp,
} from '../util/build-stamp';
import { launchArgs, TSX } from './processes';
import { stampedMembers, type Projection, type PullDescription } from '../util/emit-artifacts';
import { landStaged, writeStaged } from '../util/staged-write';
import { hashBytes } from '../util/stamp-hash';
import type { PipelineTree } from './pipeline-tree';
import {
  describesItself, type BuildStep, type ManualStep, type OutputClaims, type ResolvedStep,
} from './step-table/step-table-pure';

export type Freshness =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'stale'; readonly changed: readonly string[] };

interface RecordFields {
  readonly stamp: Stamp;
  readonly recorded?: RecordedReads;
  readonly request?: string;
  readonly requestFrom: readonly string[];
}

/** A manual step's committed record, by the step's kind. */
export type ManualRecord =
  | ({ readonly kind: 'bake' } & RecordFields)
  | ({
    readonly kind: 'pull';
    readonly query: string;
    readonly answeredBy: readonly string[];
    readonly release?: string;
  } & RecordFields);

export type ManualRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'read'; readonly record: ManualRecord };

/** What a manual step prints under `--describe`, with no network call. A bake
 *  prints only its projection. */
export type Description =
  | ({ readonly kind: 'pull' } & PullDescription & Projection)
  | ({ readonly kind: 'bake' } & Projection);

export const pullQueryHash = ({ query, services }: PullDescription): string => (
  hashBytes(JSON.stringify([query, services]))
);
export const requestHash = (request: readonly string[]): string => hashBytes(request.join('\n'));

/** Every file a step's stamp or record hashes as its output. */
export function stampedOutputs(outputs: OutputClaims): string[] {
  return [...outputs.files, ...stampedMembers(outputs.families)];
}

function verdict(changed: readonly string[]): Freshness {
  return changed.length === 0 ? { kind: 'fresh' } : { kind: 'stale', changed };
}

function stampChanges(stamp: Stamp, outputs: OutputClaims, tree: PipelineTree): string[] {
  return [
    ...changedSince(stamp.outputs, fileHashes, tree.root),
    ...outputs.files.map(tree.rel).filter((p) => !(p in stamp.outputs)),
  ];
}

/** A build step's verdict, with the input hashes it was judged on, which its stamp records if it runs. */
export interface BuildFreshness {
  readonly inputs: FileHashes;
  readonly freshness: Freshness;
}

export function buildFreshness(step: BuildStep, resolved: ResolvedStep, tree: PipelineTree): BuildFreshness {
  const inputs = inputHashes([...resolved.reads], tree.root);
  const stamp = readStamp(tree.buildStamp(step.name));
  if (stamp === null) return { inputs, freshness: { kind: 'stale', changed: ['(no stamp)'] } };
  const keys = new Set([...Object.keys(inputs), ...Object.keys(stamp.inputs)]);
  const changed = [...[...keys].filter((k) => inputs[k] !== stamp.inputs[k]), ...stampChanges(stamp, resolved.outputs, tree)];
  return { inputs, freshness: verdict(changed) };
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const isRecordedReads = (value: unknown): value is RecordedReads => typeof value === 'object' && value !== null
  && typeof (value as Partial<RecordedReads>).listings === 'object' && typeof (value as Partial<RecordedReads>).probes === 'object';

export function readManualRecord(step: ManualStep, stampFile: string): ManualRead {
  const json = readStampJson(stampFile);
  if (json === null) return { kind: existsSync(stampFile) ? 'unreadable' : 'absent' };
  const stamp = asStamp(json);
  const { requestFrom = [], answeredBy = [], recorded } = json;
  if (stamp === null || !isStrings(requestFrom) || (recorded !== undefined && !isRecordedReads(recorded))) return { kind: 'unreadable' };
  const projected = { stamp, recorded, request: optionalString(json.request), requestFrom };
  if (step.kind === 'bake') return { kind: 'read', record: { kind: 'bake', ...projected } };
  if (typeof json.query !== 'string' || !isStrings(answeredBy)) return { kind: 'unreadable' };
  return {
    kind: 'read',
    record: { kind: 'pull', query: json.query, answeredBy, release: optionalString(json.release), ...projected },
  };
}

/** The committed form `readManualRecord` reads back; landed by rename, so a
 *  record on disk is whole or absent. */
export function writeManualRecord(stampFile: string, record: ManualRecord): void {
  const { kind: _, stamp, recorded, ...fields } = record;
  writeStaged(stampFile, `${JSON.stringify({ ...stamp, recorded, ...fields }, null, 2)}\n`);
  landStaged(stampFile);
}

function parseDescription(step: ManualStep, text: string): Description {
  const json = JSON.parse(text) as Record<string, unknown>;
  const { request, requestFrom = [] } = json;
  if ((request !== undefined && !isStrings(request)) || !isStrings(requestFrom)) {
    throw new Error(`${step.name} --describe: request and requestFrom must be string lists`);
  }
  if (step.kind === 'bake') return { kind: 'bake', request, requestFrom };
  const { query, services } = json;
  if (typeof query !== 'string' || !isStrings(services) || services.length === 0) {
    throw new Error(`${step.name} --describe: a pull states its query and at least one service`);
  }
  return { kind: 'pull', query, services, release: optionalString(json.release), request, requestFrom };
}

/** A SIMBAD pull's request lists every manifest key: tens of MB, far past spawnSync's 1 MiB default. */
const DESCRIBE_MAX_BYTES = 1 << 30;

/** Python describes under `-I -S`, so its describe path imports the standard library only. */
export function describeStep(step: ManualStep, tree: PipelineTree): Description {
  const entry = tree.abs(step.entry);
  const [command, args] = step.language === 'python' ? ['python3', ['-I', '-S', entry]] : [TSX, launchArgs(entry)];
  const run = spawnSync(command, [...args, '--describe'], { encoding: 'utf8', maxBuffer: DESCRIBE_MAX_BYTES });
  if (run.status !== 0) {
    throw new Error(`${step.entry} --describe exited ${run.status ?? run.signal}: ${run.error?.message ?? run.stderr.trim()}`);
  }
  return parseDescription(step, run.stdout);
}

export function manualDescription(step: ManualStep, tree: PipelineTree): Description | null {
  return describesItself(step) ? describeStep(step, tree) : null;
}

export function manualFreshness(step: ManualStep, outputs: OutputClaims, tree: PipelineTree, now: Description | null): Freshness {
  const read = readManualRecord(step, tree.manualStamp(step.name));
  if (read.kind !== 'read') return { kind: 'stale', changed: [`(${read.kind === 'absent' ? 'no' : 'unreadable'} stamp)`] };
  const { record } = read;
  const changed = [
    ...changedSince(record.stamp.inputs, inputHashes, tree.root),
    ...stampChanges(record.stamp, outputs, tree),
    ...(record.recorded ? recordedChanges(record.recorded, tree.root) : []),
  ];
  if (now !== null) {
    if (now.kind === 'pull' && record.kind === 'pull' && pullQueryHash(now) !== record.query) changed.push('(query)');
    if ((now.request ? requestHash(now.request) : undefined) !== record.request) changed.push('(request)');
  }
  return verdict(changed);
}
