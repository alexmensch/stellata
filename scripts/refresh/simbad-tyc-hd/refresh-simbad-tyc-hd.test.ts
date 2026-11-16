import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { REPLAY_TIMEOUT_MS, replayedTable } from '../simbad/simbad-test-fixtures';
import { readTycRequest } from '../tycho2/tyc-request';
import { tycHdPull } from './simbad-tyc-hd-pure';
import { tycHdFake } from './simbad-tyc-hd-replay-pure';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadTycHd);
const INPUTS = [COMMITTED, DATA_FILES.membershipManifest, DATA_FILES.tyc2Hd].map((file) => resolve(REPO_ROOT, file));

describe.skipIf(INPUTS.some(isLfsPointerFile))('the committed simbad_tyc_hd.tsv', () => {
  it('replays through the pull, over the committed manifest and IV/25, to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const request = readTycRequest();
    const replayed = await replayedTable((file) => tycHdPull(declareOutputs({ tycHd: file }), request), tycHdFake(committed, DATA_FILES.simbadTycHd));
    expect(replayed === committed).toBe(true);
  }, REPLAY_TIMEOUT_MS);
});
