import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT, isLfsPointerFile } from '../../util/paths';
import { REPLAY_TIMEOUT_MS, record, replayedTable } from '../simbad/simbad-test-fixtures';
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
  it('replays through the pull to its own bytes', async () => {
    const committed = readFileSync(COMMITTED, 'utf8');
    const records = recordsOf(committed);
    const pull = (file: string) => valuesPull(declareOutputs({ values: file }), { records: () => records, gaiaComplete: new Set(), requestFrom: [] });
    const replayed = await replayedTable(pull, valuesFake(committed, DATA_FILES.simbadValues));
    expect(replayed === committed).toBe(true);
  }, REPLAY_TIMEOUT_MS);
});
