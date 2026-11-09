import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { REPO_ROOT, lfsContentReadable } from '../../util/paths';
import { assertTablesFit, batchQueries, queryLimit } from '../pull/pull';
import { oversizedSlices, recordedTableCases } from '../pull/recorded-reply';
import { GAIA, GAIA_SLICE_ROWS } from '../pull/tap-pure';
import { MAGNITUDE_EDGES } from './magnitude-edges';
import { MAGNITUDE_TABLE } from './magnitude-pure';
import { MAGNITUDE_PULL } from './refresh-gaia-magnitude';

/** Replies recorded from ESA on 2026-11-09: the spot rows, plus the table's first two rows. */
const MAGNITUDE_REPLY = [
  '1576683529448755328,193.50817846782095,0.7157979,55.959784778923755,1.2233584,,,,,,,2016.0,,0,1.731607,2.4691198,2.1307526,,',
  '7632157690368,45.034342834696204,0.03077455,0.23538959951604121,0.023234252,5.60229354383997,0.031825747,45.4660098305345,0.04021206,-6.834343096515991,0.029077915,2016.0,1.3809834,0,8.068802,8.554075,7.4199953,5.901028,0.27284372',
  '5878248887353382016,223.25622165148874,0.009330933,-59.514754350493064,0.012463781,1.273978621935091,0.0141610745,5.630754491199049,0.014598841,-3.9074448137078015,0.018441837,2016.0,1.001603,0,10.999999,11.876457,10.074626,-20.082495,0.18622103',
  '9281425163264,45.16500904505109,0.014150173,0.20005260394026367,0.011585267,3.8003030564808036,0.015949288,6.625745516204781,0.017342135,-53.31897375082107,0.0131098,2016.0,0.9066213,0,10.64289,10.946025,10.176743,-26.799025,0.59279585',
  '4472832130942575872,269.44850252543836,0.026238997,4.739420051112412,0.029043527,546.975939730948,0.040116355,-801.5509783684709,0.031820867,10362.394206546573,0.036070455,2016.0,1.0848505,0,8.1939745,9.791788,6.9580913,-110.46822,0.13125522',
];

describe('the magnitude pull', () => {
  const file = DATA_FILES.gaiaMagnitudePull;
  recordedTableCases('magnitude', file, MAGNITUDE_TABLE, MAGNITUDE_REPLY);

  it.skipIf(!lfsContentReadable(join(REPO_ROOT, file)))('holds every magnitude slice of the committed table within GAIA_SLICE_ROWS', () => {
    const { over, recut } = oversizedSlices(file, 'phot_g_mean_mag', MAGNITUDE_EDGES, GAIA_SLICE_ROWS, Number);
    expect(over, over.length === 0 ? '' : `re-cut the edges: ${recut().join(', ')}`).toEqual([]);
  });

  it('asks 52 slices of at most 48,000 rows, under the floor, within the table cell cap', () => {
    const queries = batchQueries(MAGNITUDE_TABLE, GAIA.quote);
    expect([queries.length, queryLimit(MAGNITUDE_TABLE)]).toEqual([52, 48_000]);
    expect(queries[0]).toMatch(/WHERE \(phot_g_mean_mag <= 11\) AND phot_g_mean_mag < 7\.108325$/);
    expect(queries[51]).toMatch(/WHERE \(phot_g_mean_mag <= 11\) AND phot_g_mean_mag >= 10\.979853$/);
    expect(() => assertTablesFit(MAGNITUDE_PULL)).not.toThrow();
  });
});
