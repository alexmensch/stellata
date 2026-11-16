import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { CROSS_INDEX } from '../classic-ids/cross-index-source';
import { MEMBERSHIP_MANIFEST } from '../membership/membership-manifest-tsv';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { artifactRows } from '../../util/sources/source';
import { FLAMSTEED_REFUSALS_LIST } from './flamsteed-refusals-source';
import { formatRefusals, refusalRows } from './flamsteed-refusals-pure';
import { readSimbadFlamsteed } from './simbad-flamsteed';

const INPUTS = [DATA_FILES.simbadIdents, DATA_FILES.membershipManifest].map((file) => resolve(REPO_ROOT, file));

describe.skipIf(INPUTS.some(isLfsPointerFile))('the frozen Flamsteed refusal list', () => {
  const hips = new Set<number>();
  const hds = new Set<number>();
  for (const row of artifactRows(MEMBERSHIP_MANIFEST)) {
    if (row.hip !== null) hips.add(row.hip);
    for (const hd of row.hd === null ? row.hdAlt : [row.hd, ...row.hdAlt]) hds.add(hd);
  }
  const derived = refusalRows(readSimbadFlamsteed(CROSS_INDEX.read()), { hips, hds });

  it('is exactly the numbers the rule refuses on a catalogue star, with their evidence', () => {
    expect(formatRefusals(DATA_FILES.flamsteedRefusals, derived)).toBe(readFileSync(resolve(REPO_ROOT, DATA_FILES.flamsteedRefusals), 'utf8'));
  });

  it('holds 37 numbers', () => {
    expect(FLAMSTEED_REFUSALS_LIST.read().length).toBe(37);
  });
});
