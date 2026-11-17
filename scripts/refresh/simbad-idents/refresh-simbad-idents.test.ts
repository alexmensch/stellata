import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { REPLAY_TIMEOUT_MS, replayedTable } from '../simbad/simbad-test-fixtures';
import { readIdentsRequest } from './refresh-simbad-idents';
import { identsPull } from './simbad-idents-pure';
import { identsFake } from './simbad-idents-replay-pure';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadIdents);
const INPUTS = [COMMITTED, DATA_FILES.simbadSptype].map((file) => resolve(REPO_ROOT, file));

describe.skipIf(INPUTS.some(isLfsPointerFile))('the committed simbad_idents.tsv', () => {
  it('replays through the pull, over the committed simbad_sptype.tsv, to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const request = readIdentsRequest();
    const replayed = await replayedTable((file) => identsPull(declareOutputs({ idents: file }), request), identsFake(committed, DATA_FILES.simbadIdents));
    expect(replayed === committed).toBe(true);
  }, REPLAY_TIMEOUT_MS);
});
