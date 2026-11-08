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
import { record } from '../simbad/simbad-test-fixtures';
import { readTable } from '../../util/tsv/table-pure';
import { valuesPull } from './simbad-values-pure';
import { valuesFake } from './simbad-values-replay-pure';

const COMMITTED = resolve(REPO_ROOT, DATA_FILES.simbadValues);

/** One manifest row per committed object, keyed on its own ids: the request a pull that reached exactly these objects asked. */
function recordsOf(text: string) {
  const columns = ['source_id', 'hip', 'tyc', 'gj'] as const;
  return [...readTable({ file: DATA_FILES.simbadValues, columns, hint: 'Replay.' }, text)].map((row) => record({
    gaiaSourceId: row.raw('source_id') || null,
    hip: row.int('hip'),
    tyc: row.raw('tyc') || null,
    gl: row.raw('gj') ? `GJ ${row.raw('gj')}` : null,
    binding: 'reviewed',
  }));
}

describe.skipIf(isLfsPointerFile(COMMITTED))('the committed simbad_values.tsv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'simbad-values-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('replays through the pull to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const records = recordsOf(committed);
    const pull = valuesPull(declareOutputs({ values: join(dir, 'values.tsv') }), { records: () => records, gaiaComplete: new Set(), requestFrom: [] });
    await runPhasedPull(pull, {
      transport: fakeTransport(valuesFake(committed, DATA_FILES.simbadValues), pull.phases, SIMBAD.quote),
      sleep: async () => {},
      report: () => {},
      log: () => {},
    });
    expect(readFileSync(join(dir, 'values.tsv'), 'utf8') === committed).toBe(true);
  }, 120_000);
});
