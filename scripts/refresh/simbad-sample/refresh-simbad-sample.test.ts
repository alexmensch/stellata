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
import { samplePull } from './simbad-sample-pure';
import { sampleFake } from './simbad-sample-replay-pure';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadSample);

describe.skipIf(isLfsPointerFile(COMMITTED))('the committed simbad_sample.tsv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'simbad-sample-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('replays through the pull to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const pull = samplePull(declareOutputs({ sample: join(dir, 'sample.tsv') }));
    await runPhasedPull(pull, {
      transport: fakeTransport(sampleFake(committed, DATA_FILES.simbadSample), pull.phases, SIMBAD.quote),
      sleep: async () => {},
      report: () => {},
      log: () => {},
    });
    expect(readFileSync(join(dir, 'sample.tsv'), 'utf8') === committed).toBe(true);
  }, 60_000);
});
