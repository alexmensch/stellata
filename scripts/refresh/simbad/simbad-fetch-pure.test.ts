import { describe, expect, it } from 'vitest';

import { phaseTemplate } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fakeAsk } from './simbad-fake-pure';
import {
  fetchBasic, fetchFlux, fetchIdents, fetchReleaseIds, parseLedger, phaseRecord, resolveOids, simbadPhases,
} from './simbad-fetch-pure';
import {
  GAIA_DR3, GJ, HIP, MAIN_ID, OID, SP_TYPE, TYC, compose, fluxColumns, likePattern, parseIdent,
} from './simbad-specs-pure';
import { simbad } from './simbad-test-fixtures';

const PHASES = simbadPhases({ basic: [OID, MAIN_ID, SP_TYPE], idents: [HIP, GAIA_DR3, TYC], fluxes: [{ filter: 'B' }, { filter: 'V' }] });
const text = (name: keyof typeof PHASES): string => {
  const phase = PHASES[name];
  if (phase === null) throw new Error(`no ${name} phase`);
  return phaseTemplate(phase, SIMBAD.quote);
};

describe('namespaces', () => {
  it('compose a request id and its LIKE pattern', () => {
    expect([compose(HIP, '12345'), compose(TYC, '144-1004-1'), likePattern(GAIA_DR3)]).toEqual(['HIP 12345', 'TYC 144-1004-1', 'Gaia DR3 %']);
  });

  it('read a numeric suffix canonically, and a component-lettered one as its number and letter', () => {
    expect(parseIdent(HIP, 'HIP 012345')).toEqual({ kind: 'suffix', suffix: '12345' });
    expect(parseIdent(HIP, 'HIP 12345 A')).toEqual({ kind: 'component', number: '12345', letter: 'A' });
    expect(parseIdent(HIP, 'HIP 055203Aa')).toEqual({ kind: 'component', number: '55203', letter: 'Aa' });
    expect(parseIdent(HIP, 'Gaia DR3 12345')).toEqual({ kind: 'other' });
    expect(parseIdent(HIP, 'HIP 12-34')).toEqual({ kind: 'unparsed', id: 'HIP 12-34' });
  });

  it('strip SIMBAD\'s padding from a text suffix', () => {
    expect(parseIdent(TYC, 'TYC  144-1004-1')).toEqual({ kind: 'suffix', suffix: '144-1004-1' });
    expect(parseIdent(GJ, 'GJ 3207')).toEqual({ kind: 'suffix', suffix: '3207' });
    expect(parseIdent(TYC, 'TYC ')).toEqual({ kind: 'unparsed', id: 'TYC ' });
  });

  it('pivot a flux band into value, error and bibcode columns', () => {
    expect(fluxColumns({ filter: 'B' })).toEqual([
      { tsv: 'flux_B', source: 'flux' }, { tsv: 'flux_B_err', source: 'flux_err' }, { tsv: 'flux_B_bibcode', source: 'bibcode' },
    ]);
  });
});

describe('the phases', () => {
  it('state each query with its request left open', () => {
    expect(text('resolve')).toBe('SELECT oidref, id FROM ident WHERE id IN ({request})');
    expect(text('basic')).toBe('SELECT oid, main_id, sp_type FROM basic WHERE oid IN ({request})');
    expect(text('idents')).toBe(
      "SELECT oidref, id FROM ident WHERE (id LIKE 'HIP %' OR id LIKE 'Gaia DR3 %' OR id LIKE 'TYC %') AND oidref IN ({request}) ORDER BY oidref, id",
    );
    expect(text('releases')).toContain("id LIKE 'Gaia DR3 %' OR id LIKE 'Gaia DR2 %' OR id LIKE 'Gaia DR1 %'");
    expect(text('flux')).toBe("SELECT oidref, filter, flux, flux_err, bibcode FROM flux WHERE (filter IN ('B', 'V')) AND oidref IN ({request})");
  });

  it('name a flux phase only when the pull asks for bands', () => {
    expect(Object.keys(phaseRecord(simbadPhases({ basic: [OID], idents: [HIP] })))).toEqual(['resolve', 'basic', 'idents', 'releases']);
  });
});

describe('resolveOids', () => {
  it('keys each suffix to its oid, a padded stored id joining its unpadded request', async () => {
    const { ask, asked } = fakeAsk(simbad({ 100: ['Gaia DR3 12345'], 200: ['Gaia DR3 67890'], 6384906: ['TYC  144-1004-1'] }));
    const ledger = parseLedger();
    expect(await resolveOids(ask, PHASES, GAIA_DR3, ['12345', '67890'], ledger)).toEqual(new Map([['12345', 100], ['67890', 200]]));
    expect(await resolveOids(ask, PHASES, TYC, ['144-1004-1'], ledger)).toEqual(new Map([['144-1004-1', 6384906]]));
    expect(asked[1].ids).toEqual(["'TYC 144-1004-1'"]);
  });

  it('refuses, before asking, a suffix an ADQL literal cannot hold', async () => {
    const { ask, asked } = fakeAsk(simbad({}));
    await expect(resolveOids(ask, PHASES, TYC, ["144'--"], parseLedger())).rejects.toThrow(/cannot hold/);
    expect(asked).toEqual([]);
  });

  it('refuses a suffix SIMBAD answers under two objects', async () => {
    const { ask } = fakeAsk(simbad({ 100: ['TYC 144-1004-1'], 101: ['TYC  144-1004-1'] }));
    await expect(resolveOids(ask, PHASES, TYC, ['144-1004-1'], parseLedger())).rejects.toThrow(/under two objects: TYC 144-1004-1 → 100 and 101/);
  });
});

describe('fetchBasic, fetchIdents, fetchFlux', () => {
  it('reads each oid\'s basic cells by column, and asks nothing for no oids', async () => {
    const { ask, asked } = fakeAsk(simbad({}, { 1: { main_id: 'Sun', sp_type: 'G2V' }, 2: { main_id: 'x', sp_type: 'DA2' } }));
    expect(await fetchBasic(ask, PHASES, [1, 2])).toEqual(new Map([
      [1, { oid: '1', main_id: 'Sun', sp_type: 'G2V' }],
      [2, { oid: '2', main_id: 'x', sp_type: 'DA2' }],
    ]));
    expect(await fetchBasic(ask, PHASES, [])).toEqual(new Map());
    expect(asked.filter((a) => a.ids?.length === 0)).toHaveLength(1);
  });

  it('ships the last id a namespace holds, and keeps every one for corroboration', async () => {
    const fake = simbad({ 100: ['HIP 1', 'Gaia DR3 9999', 'TYC  144-1004-1'], 200: ['Gaia DR3 8888'], 300: ['HIP 11', 'HIP 22', 'Gaia DR2 5'] });
    const { ask } = fakeAsk(fake);
    const ledger = parseLedger();
    const idents = await fetchIdents(ask, PHASES, [HIP, GAIA_DR3, TYC], [100, 200, 300], ledger);
    expect(idents.get(100)).toEqual(new Map([['hip', '1'], ['source_id', '9999'], ['tyc', '144-1004-1']]));
    expect(idents.get(300)?.get('hip')).toBe('22');
    expect((await fetchReleaseIds(ask, PHASES, [300], ledger)).get(300)).toEqual(new Map([['source_id_dr2', new Set(['5'])]]));
  });

  it('pivots the long flux table, a missing band leaving its cells absent', async () => {
    const { ask } = fakeAsk({
      ...simbad({}),
      flux: [{ oid: 5, filter: 'B', flux: '9.1', fluxErr: '0.02', bibcode: '2000A&A...355L..27H' }],
    });
    expect(await fetchFlux(ask, PHASES, [{ filter: 'B' }, { filter: 'V' }], [5])).toEqual(new Map([
      [5, { flux_B: '9.1', flux_B_err: '0.02', flux_B_bibcode: '2000A&A...355L..27H' }],
    ]));
  });
});

describe('parseLedger', () => {
  it('passes component-lettered ids, counted, and fails on any other unparsable shape', () => {
    const ledger = parseLedger();
    ledger.note(parseIdent(HIP, 'HIP 12345 A'));
    expect(ledger.check('ident')).toEqual({ kind: 'pass', report: 'ident: 1 component-lettered ids skipped, 0 unparsable' });
    ledger.note(parseIdent(HIP, 'HIP 12-34'));
    expect(ledger.check('ident')).toMatchObject({ kind: 'fail', message: expect.stringContaining('HIP 12-34') });
  });
});
