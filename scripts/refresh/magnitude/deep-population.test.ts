import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { EmissionRefused, declareOutputs } from '../../util/emit-artifacts';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { recordedTableCases } from '../pull/recorded-reply';
import { GAIA, type TapClientDeps } from '../pull/tap-pure';
import { deepPopulationPull, type DeepPopulationTable } from './deep-population-pure';
import { bailerJonesPull } from './refresh-bailer-jones';
import { apsisPull } from './refresh-gaia-apsis';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PARAMS: DeepPopulationTable = {
  from: 'gaiadr3.astrophysical_parameters',
  values: [{ name: 'teff', format: { fixed: 1 } }],
  magnitudeBand: { min: 2, max: 2 },
  spotRows: [{ key: 'source_id', value: '30', cells: { teff: { near: 5000, within: 0.1 } } }],
};

const BRIGHTEST_SLICE = 'g.phot_g_mean_mag < 7.108325';

/** Two sources in the brightest slice, every other slice empty; the request leg answers whichever of 30, 40 it is asked. */
function answer(adql: string, missing: readonly string[] = []): string {
  const header = 'source_id,teff\n';
  if (adql.includes(' JOIN ')) return adql.includes(BRIGHTEST_SLICE) ? `${header}30,5000\n20,6000.04\n` : header;
  const ids = /source_id IN \(([^)]*)\)/.exec(adql)?.[1].split(', ') ?? [];
  return header + ids.filter((id) => !missing.includes(id)).map((id) => `${id},4000\n`).join('');
}

function deps(reply: (adql: string) => string) {
  const asked: string[] = [];
  const d: TapClientDeps = {
    transport: async (_url, form) => {
      if (!form) return { status: 200, contentType: 'text/xml', body: '<capabilities/>' };
      const adql = form.get('QUERY') ?? '';
      asked.push(adql);
      return { status: 200, contentType: 'text/csv', body: reply(adql) };
    },
    sleep: async () => {},
    report: () => {},
    log: () => {},
  };
  return { deps: d, asked };
}

const pullOf = (request: readonly bigint[], table: DeepPopulationTable = PARAMS) => deepPopulationPull({
  archive: GAIA, outputs: declareOutputs({ table: join(dir, 'params.tsv') }), release: 'Gaia DR3', table, request,
});

describe('a deep-population pull', () => {
  it('writes both legs as one sorted table, asking the request only for the ids the magnitude leg missed', async () => {
    const { deps: d, asked } = deps((adql) => answer(adql));
    await runPhasedPull(pullOf([20n, 30n, 40n]), d);
    expect(readFileSync(join(dir, 'params.tsv'), 'utf8')).toBe('source_id\tteff\n20\t6000.0\n30\t5000.0\n40\t4000.0\n');
    expect(asked).toHaveLength(53);
    expect(asked[0]).toBe(
      'SELECT t.source_id, t.teff FROM gaiadr3.astrophysical_parameters AS t JOIN gaiadr3.gaia_source AS g ON g.source_id = t.source_id'
      + ` WHERE (g.phot_g_mean_mag <= 11) AND ${BRIGHTEST_SLICE}`,
    );
    expect(asked[52]).toBe('SELECT source_id, teff FROM gaiadr3.astrophysical_parameters WHERE source_id IN (40)');
  });

  it('refuses a request either leg covers under 90%, and writes nothing', async () => {
    const request = [20n, 30n, ...Array.from({ length: 9 }, (_, i) => BigInt(100 + i))];
    await runPhasedPull(pullOf(request), deps((adql) => answer(adql, ['100'])).deps);
    rmSync(join(dir, 'params.tsv'));
    await expect(runPhasedPull(pullOf(request), deps((adql) => answer(adql, ['100', '101'])).deps)).rejects.toThrow(EmissionRefused);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tsv'))).toEqual([]);
  });

  it('refuses a magnitude leg under its band, though the request leg brings the table inside its own', async () => {
    const narrow = { ...PARAMS, magnitudeBand: { min: 3, max: 9 } };
    await expect(runPhasedPull(pullOf([20n, 30n, 40n], narrow), deps((adql) => answer(adql)).deps)).rejects.toThrow(EmissionRefused);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tsv'))).toEqual([]);
  });

  it('describes the magnitude leg\'s slices and the request leg\'s template', () => {
    const { query } = describePhasedPull(pullOf([1n]));
    const { phases } = JSON.parse(query);
    expect(phases.magnitude.slices).toHaveLength(52);
    expect(phases.request).toBe('SELECT source_id, teff FROM gaiadr3.astrophysical_parameters WHERE source_id IN ({request})');
  });
});

describe('the Apsis and Bailer-Jones pulls', () => {
  it('ask Bailer-Jones of ESA alone, whose archive names external.gaiaedr3_distance, and Apsis of both mirrors', () => {
    expect(describePhasedPull(bailerJonesPull([1n])).services).toEqual(['ESA-sync']);
    expect(describePhasedPull(apsisPull([1n])).services).toEqual(['ESA-sync', 'ARI-sync']);
  });
});

/** Replies recorded from ESA on 2026-11-09: the spot rows, plus the table's first two rows. */
const APSIS_REPLY = [
  '9281425163264,5908.665,4.0295,-0.1902,0.0703,6385.0,4.24,0.34,F',
  '7632157690368,5028.776,3.1614,-0.1016,0.2131,4864.0,2.66,-0.2,K',
  '164919361120841856,6115.373,3.4688,-0.4904,0.677,6624.0,4.17,-0.07,F',
  '1631144127080202752,6807.42,3.6578,-0.3636,0.0655,,,,F',
  '3305738406773071744,,,,,,,,A',
];

describe('the Apsis table', () => {
  recordedTableCases('apsis', DATA_FILES.gaiaApsis, apsisPull([]).tables.table, APSIS_REPLY);
});
