// The floor over the committed pull and manifest. LFS-gated.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT, lfsContentReadable } from '../../../util/paths';
import { MEMBERSHIP_MANIFEST_FILE, iterManifestTsv } from '../membership-manifest-pure';
import { MAGNITUDE_PULL_TSV, readMagnitudeTerm } from './magnitude-term';
import {
  MAGNITUDE_PULL_G_BOUND,
  magnitudeTermNewcomers,
  type MagnitudeTermSelection,
} from './magnitude-term-pure';

const MANIFEST_PATH = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST_FILE);
const readable = [MAGNITUDE_PULL_TSV, MANIFEST_PATH].every(lfsContentReadable);

describe.skipIf(!readable)('the floor over the committed pull', () => {
  let selection: MagnitudeTermSelection;
  let boundSourceIds: Set<string>;

  beforeAll(async () => {
    selection = await readMagnitudeTerm(MAGNITUDE_PULL_G_BOUND);
    boundSourceIds = new Set<string>();
    for (const row of iterManifestTsv(readFileSync(MANIFEST_PATH, 'utf8'))) {
      if (row.gaia_source_id) boundSourceIds.add(row.gaia_source_id);
    }
  }, 120_000);

  it('partitions the pull exactly as the measurement behind the floor does', () => {
    expect(selection.counts).toEqual({
      rows: 1_247_240,
      kept: 929_929,
      above_floor: 312_475,
      no_v: 4_836,
    });
  });

  it('unions onto the manifest at the record total the floor implies', () => {
    expect(boundSourceIds.size).toBe(370_994);
    const newcomers = magnitudeTermNewcomers(selection.keptSourceIds, boundSourceIds);
    expect(newcomers.length).toBe(602_228);
    expect(boundSourceIds.size + newcomers.length).toBe(973_222);
  });

  it('keeps 327,701 sources the primaries already bind', () => {
    let both = 0;
    for (const sourceId of selection.keptSourceIds) {
      if (boundSourceIds.has(sourceId)) both++;
    }
    expect(both).toBe(327_701);
  });
});
