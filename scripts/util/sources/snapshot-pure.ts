// A committed snapshot a step checks its output against: its file and the step whose run rewrites it. See README.md#a-snapshot.

import type { Declaration } from './row-ref-pure';

declare const payload: unique symbol;

export interface Snapshot<T> extends Declaration {
  readonly kind: 'snapshot';
  /** Repo-relative. */
  readonly file: string;
  readonly script: string;
  readonly [payload]?: T;
}

export function defineSnapshot<T>(spec: { readonly file: string; readonly script: string }): Snapshot<T> {
  return { kind: 'snapshot', file: spec.file, script: spec.script } as Snapshot<T>;
}
