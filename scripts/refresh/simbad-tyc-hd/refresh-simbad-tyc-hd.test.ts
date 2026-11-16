import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { runPhasedPull } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fakeTransport } from '../simbad/simbad-fake-pure';
import { readTycRequest } from '../tycho2/tyc-request';
import { tycHdPull } from './simbad-tyc-hd-pure';
import { tycHdFake } from './simbad-tyc-hd-replay-pure';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadTycHd);
const INPUTS = [COMMITTED, DATA_FILES.membershipManifest, DATA_FILES.tyc2Hd].map((file) => resolve(REPO_ROOT, file));

describe.skipIf(INPUTS.some(isLfsPointerFile))('the committed simbad_tyc_hd.tsv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'simbad-tyc-hd-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('replays through the pull, over the committed manifest and IV/25, to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const pull = tycHdPull(declareOutputs({ tycHd: join(dir, 'tyc-hd.tsv') }), readTycRequest());
    await runPhasedPull(pull, {
      transport: fakeTransport(tycHdFake(committed, DATA_FILES.simbadTycHd), pull.phases, SIMBAD.quote),
      sleep: async () => {},
      report: () => {},
      log: () => {},
    });
    expect(readFileSync(join(dir, 'tyc-hd.tsv'), 'utf8') === committed).toBe(true);
  }, 300_000);
});
