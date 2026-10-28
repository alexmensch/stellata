// Test support: an artifact codec over its committed file. See README.md#artifact-codecs.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../paths';
import type { Artifact } from './artifact-pure';

export function describeCommittedRoundTrip<C extends string, R>(artifact: Artifact<C, R>): void {
  const path = resolve(REPO_ROOT, artifact.file);
  describe.skipIf(!lfsContentReadable(path))(`${artifact.file} codec over the committed file`, () => {
    it('round-trips byte for byte', () => {
      const text = readFileSync(path, 'utf8');
      expect(artifact.serialize(artifact.parse(text)) === text).toBe(true);
    });
  });
}
