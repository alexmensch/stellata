import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { REPLAY_TIMEOUT_MS, replayedTable } from '../simbad/simbad-test-fixtures';
import { samplePull } from './simbad-sample-pure';
import { sampleFake } from './simbad-sample-replay-pure';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadSample);

describe.skipIf(isLfsPointerFile(COMMITTED))('the committed simbad_sample.tsv', () => {
  it('replays through the pull to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const replayed = await replayedTable(samplePull, 'sample', sampleFake(committed, DATA_FILES.simbadSample));
    expect(replayed === committed).toBe(true);
  }, REPLAY_TIMEOUT_MS);
});
