import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { WDS_SUMM } from '../../wds/wds-source';
import { runPhasedPull } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fakeTransport } from '../simbad/simbad-fake-pure';
import { xidsPull } from './simbad-wds-xids-pure';
import { xidsFake } from './simbad-wds-xids-replay-pure';
import { wdsComponents } from './wds-components-pure';
import { WDS_XIDS_OVERRIDES } from './wds-xids-overrides-source';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadWdsXids);

describe.skipIf(isLfsPointerFile(COMMITTED) || isLfsPointerFile(resolve(REPO_ROOT, WDS_SUMM.file)))('the committed simbad_wds_xids.tsv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'simbad-wds-xids-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('replays through the pull, over the committed WDS summary and overrides, to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const pull = xidsPull(declareOutputs({ xids: join(dir, 'xids.tsv') }), {
      components: wdsComponents(WDS_SUMM.read()),
      overrides: WDS_XIDS_OVERRIDES.read(),
      overridesFile: WDS_XIDS_OVERRIDES.file,
      requestFrom: [],
    });
    await runPhasedPull(pull, {
      transport: fakeTransport(xidsFake(committed, DATA_FILES.simbadWdsXids), pull.phases, SIMBAD.quote),
      sleep: async () => {},
      report: () => {},
      log: () => {},
    });
    expect(readFileSync(join(dir, 'xids.tsv'), 'utf8') === committed).toBe(true);
  }, 120_000);
});
