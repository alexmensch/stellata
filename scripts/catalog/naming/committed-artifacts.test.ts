import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import type { Artifact } from '../../util/tsv/artifact-pure';
import { NAMING_DUPLICATES } from './naming-duplicates-tsv';
import { NAMING_PARITY } from './naming-parity-tsv';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';
import { WGSN_NAMES } from './wgsn-names-tsv';

function roundTrips<C extends string, R>(artifact: Artifact<C, R>): void {
  const path = resolve(REPO_ROOT, artifact.file);
  describe.skipIf(!lfsContentReadable(path))(`${artifact.file} codec over the committed file`, () => {
    it('round-trips byte for byte', () => {
      const text = readFileSync(path, 'utf8');
      expect(artifact.serialize(artifact.parse(text)) === text).toBe(true);
    });
  });
}

roundTrips(WGSN_NAMES);
roundTrips(WGSN_DESIGNATIONS);
roundTrips(NAMING_PARITY);
roundTrips(NAMING_DUPLICATES);
