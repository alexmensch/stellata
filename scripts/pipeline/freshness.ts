// Whether a step's record still matches the disk: one test for every kind. See README.md#freshness--one-mechanism.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  asStamp, changedSince, readStamp, readStampJson, recordedChanges, type FileHashes, type Stamp,
} from '../util/build-stamp';
import { REPO_ROOT } from '../util/paths';
import type { ManualStep, OutputClaims } from './step-table-pure';

export type Freshness =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'stale'; readonly changed: readonly string[] };

/** A manual step's committed record, by the step's kind. A pull's `requestFrom`
 *  files order it after their writers but count only through `request`. */
export type ManualRecord =
  | { readonly kind: 'bake'; readonly stamp: Stamp }
  | {
    readonly kind: 'pull';
    readonly stamp: Stamp;
    readonly query: string;
    readonly request?: string;
    readonly requestFrom: readonly string[];
    readonly answeredBy?: string;
    readonly release?: string;
  };

export type ManualRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'read'; readonly record: ManualRecord };

/** What a pull prints under `--describe`, with no network call. */
export interface PullDescription {
  readonly query: string;
  readonly services: readonly string[];
  readonly request?: readonly string[];
}

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex');

export const pullQueryHash = ({ query, services }: PullDescription): string => sha1(JSON.stringify([query, services]));
export const requestHash = (request: readonly string[]): string => sha1(request.join('\n'));

function verdict(changed: readonly string[]): Freshness {
  return changed.length === 0 ? { kind: 'fresh' } : { kind: 'stale', changed };
}

function declaredUnrecorded(outputs: OutputClaims, recorded: FileHashes): string[] {
  return outputs.files.map((p) => relative(REPO_ROOT, p)).filter((p) => !(p in recorded));
}

function stampChanges(stamp: Stamp, outputs: OutputClaims): string[] {
  return [
    ...changedSince(stamp.outputs),
    ...declaredUnrecorded(outputs, stamp.outputs),
    ...(stamp.recorded ? recordedChanges(stamp.recorded) : []),
  ];
}

export function derivedFreshness(stampFile: string, outputs: OutputClaims, inputs: FileHashes): Freshness {
  const stamp = readStamp(stampFile);
  if (stamp === null) return { kind: 'stale', changed: ['(no stamp)'] };
  const keys = new Set([...Object.keys(inputs), ...Object.keys(stamp.inputs)]);
  return verdict([...[...keys].filter((k) => inputs[k] !== stamp.inputs[k]), ...stampChanges(stamp, outputs)]);
}

export function recordedFreshness(stampFile: string, outputs: OutputClaims): Freshness {
  const stamp = readStamp(stampFile);
  if (stamp === null) return { kind: 'stale', changed: ['(no stamp)'] };
  return verdict([...changedSince(stamp.inputs), ...stampChanges(stamp, outputs)]);
}

const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function readManualRecord(step: ManualStep, stampFile: string): ManualRead {
  const json = readStampJson(stampFile);
  if (json === null) return { kind: existsSync(stampFile) ? 'unreadable' : 'absent' };
  const stamp = asStamp(json);
  if (stamp === null) return { kind: 'unreadable' };
  if (step.kind === 'bake') return { kind: 'read', record: { kind: 'bake', stamp } };
  const { query, requestFrom = [] } = json;
  if (typeof query !== 'string' || !Array.isArray(requestFrom)) return { kind: 'unreadable' };
  return {
    kind: 'read',
    record: {
      kind: 'pull',
      stamp,
      query,
      request: optionalString(json.request),
      requestFrom: requestFrom.map(String),
      answeredBy: optionalString(json.answeredBy),
      release: optionalString(json.release),
    },
  };
}

export function describePull(entry: string): PullDescription {
  const run = spawnSync('python3', ['-I', '-S', entry, '--describe'], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`${entry} --describe exited ${run.status}: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout) as PullDescription;
}

export function manualFreshness(
  step: ManualStep,
  stampFile: string,
  outputs: OutputClaims,
): Freshness {
  const read = readManualRecord(step, stampFile);
  if (read.kind !== 'read') return { kind: 'stale', changed: [`(${read.kind === 'absent' ? 'no' : 'unreadable'} stamp)`] };
  const { record } = read;
  const changed = [...changedSince(record.stamp.inputs), ...stampChanges(record.stamp, outputs)];
  if (record.kind === 'pull') {
    const now = describePull(resolve(REPO_ROOT, step.entry));
    if (pullQueryHash(now) !== record.query) changed.push('(query)');
    if ((now.request ? requestHash(now.request) : undefined) !== record.request) changed.push('(request)');
  }
  return verdict(changed);
}
