// Whether a step's record still matches the disk: one test for every kind. See README.md#freshness--one-mechanism.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import {
  changedSince, readStamp, recordedChanges, type FileHashes, type Stamp,
} from '../util/build-stamp';
import { REPO_ROOT } from '../util/paths';
import type { ManualStep, OutputClaims } from './step-table-pure';

export type Freshness =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'stale'; readonly changed: readonly string[] };

/** A manual step's committed record; a pull's adds its query and derived request. */
export interface ManualStamp extends Stamp {
  readonly query?: string;
  readonly request?: string;
  readonly answeredBy?: string;
  readonly release?: string;
}

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

export function readManualStamp(stampFile: string): ManualStamp | null {
  const stamp = readStamp(stampFile);
  if (stamp === null) return null;
  const { query, request, answeredBy, release } = JSON.parse(readFileSync(stampFile, 'utf8')) as ManualStamp;
  return { ...stamp, query, request, answeredBy, release };
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
  describe: (entry: string) => PullDescription,
): Freshness {
  if (!existsSync(stampFile)) return { kind: 'stale', changed: ['(no stamp)'] };
  const stamp = readManualStamp(stampFile);
  if (stamp === null) return { kind: 'stale', changed: ['(unreadable stamp)'] };
  const changed = [...changedSince(stamp.inputs), ...stampChanges(stamp, outputs)];
  if (step.kind === 'pull') {
    const now = describe(resolve(REPO_ROOT, step.entry));
    if (pullQueryHash(now) !== stamp.query) changed.push('(query)');
    if ((now.request ? requestHash(now.request) : undefined) !== stamp.request) changed.push('(request)');
  }
  return verdict(changed);
}
