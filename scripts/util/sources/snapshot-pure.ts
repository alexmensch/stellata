// A committed snapshot a step checks its output against: its file and the step whose run rewrites it. See README.md#a-snapshot.

import { isAbsolute } from 'node:path';

import type { Declaration } from './row-ref-pure.ts';

/** The only module names a `defineSnapshot` may live in, each declaring one snapshot and nothing else. */
export const SNAPSHOT_MODULE_SUFFIX = '-expected-json.ts';

declare const payload: unique symbol;

export interface Snapshot<T> extends Declaration {
  readonly kind: 'snapshot';
  /** Repo-relative. */
  readonly file: string;
  readonly script: string;
  readonly [payload]?: T;
}

export function defineSnapshot<T>(spec: { readonly file: string; readonly script: string }): Snapshot<T> {
  if (isAbsolute(spec.file)) throw new Error(`defineSnapshot: ${spec.file} must be repo-relative`);
  return { kind: 'snapshot', file: spec.file, script: spec.script } as Snapshot<T>;
}
