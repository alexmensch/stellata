import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { WDS_SUMM } from '../../wds/wds-source';
import { REPLAY_TIMEOUT_MS, replayedTable } from '../simbad/simbad-test-fixtures';
import { xidsPull } from './simbad-wds-xids-pure';
import { xidsFake } from './simbad-wds-xids-replay-pure';
import { wdsComponents } from './wds-components-pure';
import { WDS_XIDS_OVERRIDES } from './wds-xids-overrides-source';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadWdsXids);

describe.skipIf(isLfsPointerFile(COMMITTED) || isLfsPointerFile(resolve(REPO_ROOT, WDS_SUMM.file)))('the committed simbad_wds_xids.tsv', () => {
  it('replays through the pull, over the committed WDS summary and overrides, to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const inputs = {
      components: wdsComponents(WDS_SUMM.read()),
      overrides: WDS_XIDS_OVERRIDES.read(),
      overridesFile: WDS_XIDS_OVERRIDES.file,
      requestFrom: [],
    };
    const replayed = await replayedTable((outputs) => xidsPull(outputs, inputs), 'xids', xidsFake(committed, DATA_FILES.simbadWdsXids));
    expect(replayed === committed).toBe(true);
  }, REPLAY_TIMEOUT_MS);
});
