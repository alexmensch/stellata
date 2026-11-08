import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pullQueryHash } from '../../pipeline/freshness';
import { EmissionRefused, declareOutputs } from '../../util/emit-artifacts';
import {
  LIMIT_HEADROOM, MAX_WHOLE_TABLE_CELLS, assertWholeTablesFit, batchQueries, describePhasedPull, describePull, phaseLimit,
  phaseQueries, queryLimit, runPhasedPull, runPull, type Phase, type PhasedPull, type Pull, type PullTable, type WrittenTable,
} from './pull';
import { checkpoint } from './checkpoint';
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
  const reported: string[] = [];
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
    report: (service) => reported.push(service),
    log: () => {},
  };
  return { deps: d, asked, reported };
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

  it('a failing gate keeps the checkpoint, and a re-run replays it without asking again, reporting who answered', async () => {
    const drifted = { ...STARS, spotRows: [{ key: 'source_id', value: '1', cells: { parallax: '0.6' } }] } as const;
    const first = deps(GOOD);
    await expect(runPull(pullOf({ stars: drifted, pairs: PAIRS }), first.deps)).rejects.toThrow(EmissionRefused);
    expect(readdirSync(ckpt()).filter((f) => f.endsWith('.csv'))).toHaveLength(3);

    const second = deps(GOOD);
    await runPull(pullOf({ stars: STARS, pairs: PAIRS }), second.deps);
    expect(second.asked).toEqual([]);
    expect(second.reported).toEqual(['ESA-sync', 'ESA-sync', 'ESA-sync']);
    expect(existsSync(ckpt())).toBe(false);
  });

  it('a seeded reply replays reporting no service, and a cached reply with no service record is refused', async () => {
    const seeded = checkpoint(ckpt());
    for (const adql of batchQueries(STARS, GAIA.quote)) seeded.save(adql, { body: GOOD(adql), service: null });
    for (const adql of batchQueries(PAIRS, GAIA.quote)) seeded.save(adql, { body: GOOD(adql), service: null });
    const replay = deps(GOOD);
    await runPull(pullOf({ stars: STARS, pairs: PAIRS }), replay.deps);
    expect([replay.asked, replay.reported]).toEqual([[], []]);

    seeded.save('SELECT 1', { body: 'x\n', service: null });
    rmSync(join(ckpt(), readdirSync(ckpt()).find((f) => f.endsWith('.json')) as string));
    expect(() => seeded.load('SELECT 1')).toThrow(/no record of the service/);
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

  it('refuses, before asking anything, a whole-table query too large for one reply', async () => {
    const fits = Math.floor(MAX_WHOLE_TABLE_CELLS / (LIMIT_HEADROOM * STARS.columns.length));
    const { deps: d, asked } = deps(GOOD);
    const huge = { ...STARS, band: { min: 0, max: fits + 1 } };
    await expect(runPull(pullOf({ stars: huge, pairs: PAIRS }), d)).rejects.toThrow(/exceeds 37000000; batch the query/);
    expect(asked).toEqual([]);
    expect(() => assertWholeTablesFit(pullOf({ stars: { ...STARS, band: { min: 0, max: fits } }, pairs: PAIRS }))).not.toThrow();
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

describe('a phased pull', () => {
  const RESOLVE: Phase = {
    from: 'ident', columns: [{ name: 'oidref' }, { name: 'id' }], scope: { kind: 'request', key: 'id', batchSize: 2, rowsPerId: 1 },
  };
  const BASIC: Phase = {
    from: 'basic', columns: [{ name: 'oid' }, { name: 'sp_type' }], scope: { kind: 'request', key: 'oid', batchSize: 2, rowsPerId: 1 },
  };
  const TYPES: WrittenTable = {
    columns: [{ name: 'simbad_oid' }, { name: 'sp_type' }],
    sortBy: [{ column: 'simbad_oid', as: 'integer' }],
    band: { min: 1, max: 3 },
    spotRows: [{ key: 'simbad_oid', value: '7', cells: { sp_type: 'G2V' } }],
  };
  const SIMBAD_ANSWER = (adql: string): string => (adql.includes('FROM ident')
    ? 'oidref,id\n7,HIP 1\n9,HIP 2\n'
    : 'oid,sp_type\n9,K0\n7,G2V\n');

  const typesPull = (run: PhasedPull<'types'>['run'], extra: Partial<PhasedPull<'types'>> = {}): PhasedPull<'types'> => ({
    archive: SIMBAD,
    outputs: declareOutputs({ types: join(dir, 'types.tsv') }),
    phases: { resolve: RESOLVE, basic: BASIC },
    tables: { types: TYPES },
    run,
    ...extra,
  });

  const twoPhases: PhasedPull<'types'>['run'] = async (ask) => {
    const oids = (await ask(RESOLVE, ["'HIP 1'", "'HIP 2'"])).map((row) => row[0] ?? '');
    return { rows: { types: await ask(BASIC, oids) }, checks: [] };
  };

  it('asks a later phase with ids an earlier one answered, and writes the gated table', async () => {
    const { deps: d, asked } = deps(SIMBAD_ANSWER);
    await runPhasedPull(typesPull(twoPhases), d);
    expect(asked).toEqual(["SELECT oidref, id FROM ident WHERE id IN ('HIP 1', 'HIP 2')", 'SELECT oid, sp_type FROM basic WHERE oid IN (7, 9)']);
    expect(read('types.tsv')).toBe('simbad_oid\tsp_type\n7\tG2V\n9\tK0\n');
  });

  it('refuses a phase it does not declare, so its describe states every query it sends', async () => {
    const undeclared: Phase = { ...BASIC, from: 'flux' };
    const pull = typesPull(async (ask) => ({ rows: { types: await ask(undeclared, ['7']) }, checks: [] }));
    await expect(runPhasedPull(pull, deps(SIMBAD_ANSWER).deps)).rejects.toThrow(/does not declare/);
  });

  it('asks nothing for an empty request, and refuses ids on a whole-table phase', async () => {
    const { deps: d, asked } = deps(SIMBAD_ANSWER);
    const whole: Phase = { ...BASIC, scope: { kind: 'whole-table', maxRows: 3 } };
    await expect(runPhasedPull(typesPull(async (ask) => {
      expect(await ask(RESOLVE, [])).toEqual([]);
      return { rows: { types: await ask(whole, ['7']) }, checks: [] };
    }, { phases: { resolve: RESOLVE, whole } }), d)).rejects.toThrow(/takes no request ids/);
    expect(asked).toEqual([]);
  });

  it('a failing check the run computed refuses the emission', async () => {
    const failing: PhasedPull<'types'>['run'] = async (ask) => ({
      ...(await twoPhases(ask, () => {})),
      checks: [{ kind: 'fail', message: 'resolution under its floor' }],
    });
    await expect(runPhasedPull(typesPull(failing), deps(SIMBAD_ANSWER).deps)).rejects.toThrow(EmissionRefused);
    expect(existsSync(join(dir, 'types.tsv'))).toBe(false);
  });

  it('describes every phase\'s query, each table\'s formats and order, and the request it derives', () => {
    const pull = typesPull(twoPhases, { request: { request: ['hip:1', 'hip:2'], requestFrom: ['manifest.tsv'] } });
    expect(describePhasedPull(pull)).toEqual({
      query: JSON.stringify({
        phases: { resolve: 'SELECT oidref, id FROM ident WHERE id IN ({request})', basic: 'SELECT oid, sp_type FROM basic WHERE oid IN ({request})' },
        tables: { types: { formats: {}, sortBy: TYPES.sortBy } },
      }),
      services: ['SIMBAD-CDS', 'SIMBAD-Harvard'],
      request: ['hip:1', 'hip:2'],
      requestFrom: ['manifest.tsv'],
    });
  });

  it('states its parameters, so a changed seed or target stales the record', () => {
    const hash = (seed: number) => pullQueryHash(describePhasedPull(typesPull(twoPhases, { parameters: { seed } })));
    expect(hash(1)).not.toBe(hash(2));
  });

  it('sizes a whole-table phase off its stated rows and a request batch off its ids', () => {
    expect([phaseLimit({ ...BASIC, scope: { kind: 'whole-table', maxRows: 5 } }), phaseLimit(BASIC)]).toEqual([10, 4]);
    expect(phaseQueries(BASIC, ['1', '2', '3'], SIMBAD.quote)).toHaveLength(2);
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
