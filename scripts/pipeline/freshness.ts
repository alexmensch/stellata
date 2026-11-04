// Whether a step's record still matches the disk: one test for every kind. See README.md#freshness--one-mechanism.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import {
  asStamp, changedSince, readStamp, readStampJson, recordedChanges, type FileHashes, type Stamp,
} from '../util/build-stamp';
import { TSX } from './processes';
import { stampedMembers, type PullDescription } from '../util/emit-artifacts';
import { landStaged, writeStaged } from '../util/staged-write';
import type { PipelineTree } from './pipeline-tree';
import { describesItself, type ManualStep, type OutputClaims } from './step-table/step-table-pure';

export type Freshness =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'stale'; readonly changed: readonly string[] };

interface Projected {
  readonly request?: string;
  readonly requestFrom: readonly string[];
}

/** A manual step's committed record, by the step's kind. */
export type ManualRecord =
  | ({ readonly kind: 'bake'; readonly stamp: Stamp } & Projected)
  | ({
    readonly kind: 'pull';
    readonly stamp: Stamp;
    readonly query: string;
    readonly answeredBy: readonly string[];
    readonly release?: string;
  } & Projected);

export type ManualRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'read'; readonly record: ManualRecord };

/** What a manual step prints under `--describe`, with no network call. A bake
 *  prints only its projection. */
interface DerivedRequest {
  readonly request?: readonly string[];
  readonly requestFrom: readonly string[];
}

export type Description =
  | ({ readonly kind: 'pull' } & PullDescription & DerivedRequest)
  | ({ readonly kind: 'bake' } & DerivedRequest);

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

export const pullQueryHash = ({ query, services }: PullDescription): string => (
  sha1(JSON.stringify([query, services]))
);
export const requestHash = (request: readonly string[]): string => sha1(request.join('\n'));

/** Every file a step's stamp or record hashes as its output. */
export function stampedOutputs(outputs: OutputClaims): string[] {
  return [...outputs.files, ...stampedMembers(outputs.families)];
}

function verdict(changed: readonly string[]): Freshness {
  return changed.length === 0 ? { kind: 'fresh' } : { kind: 'stale', changed };
}

function stampChanges(stamp: Stamp, outputs: OutputClaims, tree: PipelineTree): string[] {
  return [
    ...changedSince(stamp.outputs, tree.root),
    ...outputs.files.map(tree.rel).filter((p) => !(p in stamp.outputs)),
    ...(stamp.recorded ? recordedChanges(stamp.recorded, tree.root) : []),
  ];
}

export function derivedFreshness(stampFile: string, outputs: OutputClaims, inputs: FileHashes, tree: PipelineTree): Freshness {
  const stamp = readStamp(stampFile);
  if (stamp === null) return { kind: 'stale', changed: ['(no stamp)'] };
  const keys = new Set([...Object.keys(inputs), ...Object.keys(stamp.inputs)]);
  return verdict([...[...keys].filter((k) => inputs[k] !== stamp.inputs[k]), ...stampChanges(stamp, outputs, tree)]);
}

export function recordedFreshness(stampFile: string, outputs: OutputClaims, tree: PipelineTree): Freshness {
  const stamp = readStamp(stampFile);
  if (stamp === null) return { kind: 'stale', changed: ['(no stamp)'] };
  return verdict([...changedSince(stamp.inputs, tree.root), ...stampChanges(stamp, outputs, tree)]);
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function readManualRecord(step: ManualStep, stampFile: string): ManualRead {
  const json = readStampJson(stampFile);
  if (json === null) return { kind: existsSync(stampFile) ? 'unreadable' : 'absent' };
  const stamp = asStamp(json);
  const { requestFrom = [], answeredBy = [] } = json;
  if (stamp === null || !isStrings(requestFrom)) return { kind: 'unreadable' };
  const projected = { request: optionalString(json.request), requestFrom };
  if (step.kind === 'bake') return { kind: 'read', record: { kind: 'bake', stamp, ...projected } };
  if (typeof json.query !== 'string' || !isStrings(answeredBy)) return { kind: 'unreadable' };
  return {
    kind: 'read',
    record: { kind: 'pull', stamp, query: json.query, answeredBy, release: optionalString(json.release), ...projected },
  };
}

/** The committed form `readManualRecord` reads back; landed by rename, so a
 *  record on disk is whole or absent. */
export function writeManualRecord(stampFile: string, record: ManualRecord): void {
  const { kind: _, stamp, ...fields } = record;
  writeStaged(stampFile, `${JSON.stringify({ ...stamp, ...fields }, null, 2)}\n`);
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
  const [command, args] = step.language === 'python' ? ['python3', ['-I', '-S', entry]] : [TSX, [entry]];
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
  const changed = [...changedSince(record.stamp.inputs, tree.root), ...stampChanges(record.stamp, outputs, tree)];
  if (now !== null) {
    if (now.kind === 'pull' && record.kind === 'pull' && pullQueryHash(now) !== record.query) changed.push('(query)');
    if ((now.request ? requestHash(now.request) : undefined) !== record.request) changed.push('(request)');
  }
  return verdict(changed);
}
