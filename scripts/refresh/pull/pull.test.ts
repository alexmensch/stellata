import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pullQueryHash } from '../../pipeline/freshness';
import { EmissionRefused, declareOutputs } from '../../util/emit-artifacts';
import { batchQueries, describePull, queryLimit, runPull, type Pull, type PullTable } from './pull';
import { GAIA, SIMBAD, TapOverflow, VIZIER, type TapArchive, type TapClientDeps } from './tap-pure';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pull-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const STARS: PullTable = {
  from: 'gaiadr3.gaia_source',
  columns: [{ name: 'source_id' }, { name: 'parallax' }],
  sortBy: [{ column: 'source_id', as: 'integer' }],
  scope: { kind: 'whole-table' },
  band: { min: 2, max: 3 },
  spotRows: [{ key: 'source_id', value: '1', cells: { parallax: '0.5' } }],
};

const PAIRS: PullTable = {
  from: 'gaiadr3.nss_two_body_orbit',
  columns: [{ name: 'source_id' }, { name: 'period' }],
  sortBy: [{ column: 'source_id', as: 'integer' }],
  scope: { kind: 'request', key: 'source_id', idColumn: 'source_id', ids: ['1', '2', '3'], batchSize: 2, rowsPerId: 1 },
  band: { min: 1, max: 3 },
  spotRows: [{ key: 'source_id', value: '2', cells: { period: '10' } }],
};

function pullOf(tables: Record<'stars' | 'pairs', PullTable>, archive: TapArchive = GAIA): Pull<'stars' | 'pairs'> {
  return {
    archive,
    outputs: declareOutputs({ stars: join(dir, 'stars.tsv'), pairs: join(dir, 'pairs.tsv') }),
    tables,
  };
}

/** Answers each sync query with the CSV `answer` gives for its ADQL; counts the queries asked. */
function deps(answer: (adql: string) => string | Error) {
  const asked: string[] = [];
  const d: TapClientDeps = {
    transport: async (_url, form) => {
      if (!form) return { status: 200, contentType: 'text/xml', body: '<capabilities/>' };
      const adql = form.get('QUERY') ?? '';
      asked.push(adql);
      const body = answer(adql);
      if (body instanceof Error) throw body;
      return { status: 200, contentType: 'text/csv', body };
    },
    sleep: async () => {},
    report: () => {},
    log: () => {},
  };
  return { deps: d, asked };
}

const GOOD = (adql: string): string => (adql.includes('nss_two_body_orbit')
  ? `source_id,period\n${adql.includes('IN (3)') ? '3,7' : '2,10\n1,5'}\n`
  : 'source_id,parallax\n1,0.5\n2,\n');

const ckpt = (): string => join(dir, 'stars.tsv.ckpt');
const read = (name: string): string => readFileSync(join(dir, name), 'utf8');

describe('runPull', () => {
  it('writes every output, gated and sorted across batches, and clears its checkpoint', async () => {
    const { deps: d, asked } = deps(GOOD);
    await runPull(pullOf({ stars: STARS, pairs: PAIRS }), d);
    expect(read('stars.tsv')).toBe('source_id\tparallax\n1\t0.5\n2\t\n');
    expect(read('pairs.tsv')).toBe('source_id\tperiod\n1\t5\n2\t10\n3\t7\n');
    expect(asked).toEqual([
      'SELECT source_id, parallax FROM gaiadr3.gaia_source',
      'SELECT source_id, period FROM gaiadr3.nss_two_body_orbit WHERE source_id IN (1, 2)',
      'SELECT source_id, period FROM gaiadr3.nss_two_body_orbit WHERE source_id IN (3)',
    ]);
    expect(existsSync(ckpt())).toBe(false);
  });

  it.each([['Gaia', GAIA], ['VizieR', VIZIER], ['SIMBAD', SIMBAD]] as const)(
    '%s: an overflowed reply raises and writes nothing',
    async (_, archive) => {
      const overfull = `source_id,parallax\n${Array.from({ length: queryLimit(STARS) + 1 }, (_, i) => `${i},1`).join('\n')}\n`;
      const { deps: d } = deps(() => overfull);
      await expect(runPull(pullOf({ stars: STARS, pairs: PAIRS }, archive), d)).rejects.toThrow(TapOverflow);
      expect(readdirSync(dir).filter((f) => f.endsWith('.tsv'))).toEqual([]);
    },
  );

  it('a failing gate keeps the checkpoint, and a re-run replays it without asking again', async () => {
    const drifted = { ...STARS, spotRows: [{ key: 'source_id', value: '1', cells: { parallax: '0.6' } }] } as const;
    const first = deps(GOOD);
    await expect(runPull(pullOf({ stars: drifted, pairs: PAIRS }), first.deps)).rejects.toThrow(EmissionRefused);
    expect(readdirSync(ckpt())).toHaveLength(3);

    const second = deps(GOOD);
    await runPull(pullOf({ stars: STARS, pairs: PAIRS }), second.deps);
    expect(second.asked).toEqual([]);
    expect(existsSync(ckpt())).toBe(false);
  });

  it('a changed query invalidates its checkpointed answer', async () => {
    const first = deps(GOOD);
    const drifted = { ...STARS, band: { min: 9, max: 9 } };
    await expect(runPull(pullOf({ stars: drifted, pairs: PAIRS }), first.deps)).rejects.toThrow(EmissionRefused);

    const second = deps(GOOD);
    await runPull(pullOf({ stars: { ...STARS, where: 'parallax IS NOT NULL OR source_id = 2' }, pairs: PAIRS }), second.deps);
    expect(second.asked).toEqual(['SELECT source_id, parallax FROM gaiadr3.gaia_source WHERE parallax IS NOT NULL OR source_id = 2']);
  });

  it('a multi-output pull that fails after its first output leaves every prior output untouched', async () => {
    writeFileSync(join(dir, 'stars.tsv'), 'old stars\n');
    writeFileSync(join(dir, 'pairs.tsv'), 'old pairs\n');
    const failingGate = { ...PAIRS, band: { min: 4, max: 9 } };
    await expect(runPull(pullOf({ stars: STARS, pairs: failingGate }), deps(GOOD).deps)).rejects.toThrow(EmissionRefused);
    rmSync(ckpt(), { recursive: true });
    const failingQuery = deps((adql) => (adql.includes('IN (3)') ? new Error('connect ETIMEDOUT') : GOOD(adql)));
    await expect(runPull(pullOf({ stars: STARS, pairs: PAIRS }), failingQuery.deps)).rejects.toThrow('ETIMEDOUT');
    expect([read('stars.tsv'), read('pairs.tsv')]).toEqual(['old stars\n', 'old pairs\n']);
  });

  it('refuses a reply whose columns are not the declared ones', async () => {
    const { deps: d } = deps((adql) => (adql.includes('gaia_source') ? 'source_id,plx\n1,0.5\n' : GOOD(adql)));
    await expect(runPull(pullOf({ stars: STARS, pairs: PAIRS }), d)).rejects.toThrow(/are not the declared/);
  });
});

describe('describePull', () => {
  it('states each table\'s query without its request ids, and the mirrors', () => {
    const description = describePull({ ...pullOf({ stars: STARS, pairs: PAIRS }), release: 'Gaia DR3' });
    expect(description).toEqual({
      query: JSON.stringify({
        stars: { query: 'SELECT source_id, parallax FROM gaiadr3.gaia_source', formats: {}, sortBy: STARS.sortBy },
        pairs: {
          query: 'SELECT source_id, period FROM gaiadr3.nss_two_body_orbit WHERE source_id IN ({request})',
          formats: {},
          sortBy: PAIRS.sortBy,
        },
      }),
      services: ['ESA-sync', 'ARI-sync'],
      release: 'Gaia DR3',
    });
  });

  it('a changed rounding changes the query hash', () => {
    const rounded = (fixed: number): PullTable => ({ ...STARS, columns: [{ name: 'source_id' }, { name: 'parallax', format: { fixed } }] });
    const hash = (fixed: number) => pullQueryHash(describePull(pullOf({ stars: rounded(fixed), pairs: PAIRS })));
    expect(hash(3)).not.toBe(hash(4));
  });
});

describe('batchQueries and queryLimit', () => {
  it('ANDs a request onto a stated WHERE, quoting identifiers as the archive does', () => {
    const table: PullTable = { ...PAIRS, from: '"I/311/hip2"', where: '"Plx" > 0', columns: [{ name: 'HIP' }] };
    expect(batchQueries(table, VIZIER.quote)[0]).toBe('SELECT "HIP" FROM "I/311/hip2" WHERE ("Plx" > 0) AND source_id IN (1, 2)');
  });

  it('sizes a whole-table query off its band and a batch off its request', () => {
    expect([queryLimit(STARS), queryLimit(PAIRS)]).toEqual([6, 4]);
  });
});

export function pullsWithoutRequiredGatesDoNotCompile(): PullTable[] {
  const { band, spotRows, ...ungated } = STARS;
  return [
    // @ts-expect-error a table without a row band
    { ...ungated, spotRows },
    // @ts-expect-error a table without spot rows
    { ...ungated, band },
    // @ts-expect-error a table with an empty spot-row list
    { ...ungated, band, spotRows: [] },
  ];
}

export function pullsWithoutWriteOrderDoNotCompile(): PullTable[] {
  const { sortBy: _, ...unordered } = STARS;
  return [
    // @ts-expect-error a table without a sort key
    unordered,
    // @ts-expect-error a table with an empty sort key
    { ...unordered, sortBy: [] },
  ];
}
