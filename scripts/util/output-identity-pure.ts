// Before/after comparison of build-output hashes. See scripts/util/README.md.

import type { FileHashes } from './build-stamp';

export interface OutputDifference {
  readonly changed: readonly string[];
  readonly appeared: readonly string[];
  readonly vanished: readonly string[];
}

export function diffOutputHashes(before: FileHashes, after: FileHashes): OutputDifference {
  const changed: string[] = [];
  const appeared: string[] = [];
  const vanished: string[] = [];
  for (const path of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const was = before[path] ?? null;
    const now = after[path] ?? null;
    if (was === now) continue;
    if (was === null) appeared.push(path);
    else if (now === null) vanished.push(path);
    else changed.push(path);
  }
  return { changed, appeared, vanished };
}

export function isIdentical(d: OutputDifference): boolean {
  return d.changed.length + d.appeared.length + d.vanished.length === 0;
}

export function formatDifference(d: OutputDifference): string[] {
  return [
    ...d.changed.map((p) => `changed   ${p}`),
    ...d.appeared.map((p) => `appeared  ${p}`),
    ...d.vanished.map((p) => `vanished  ${p}`),
  ];
}
