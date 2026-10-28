// Test support: an artifact codec over its committed file. See README.md#artifact-codecs.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../paths';
import type { Artifact } from './artifact-pure';

export function firstDifferingLine(
  committed: string,
  written: string,
): { line: number; committed: string; written: string } | null {
  if (committed === written) return null;
  const a = committed.split('\n');
  const b = written.split('\n');
  let i = 0;
  while (a[i] === b[i]) i++;
  return { line: i + 1, committed: a[i] ?? '(end of file)', written: b[i] ?? '(end of file)' };
}

export function describeCommittedRoundTrip<C extends string, R>(artifact: Artifact<C, R>): void {
  const path = resolve(REPO_ROOT, artifact.file);
  describe.skipIf(!lfsContentReadable(path))(`${artifact.file} codec over the committed file`, () => {
    it('round-trips byte for byte', () => {
      const text = readFileSync(path, 'utf8');
      const diff = firstDifferingLine(text, artifact.serialize(artifact.parse(text)));
      if (diff !== null) {
        throw new Error(
          `${artifact.file}:${diff.line} changes in the round trip\n`
            + `  committed: ${JSON.stringify(diff.committed)}\n  written:   ${JSON.stringify(diff.written)}`,
        );
      }
    });
  });
}
