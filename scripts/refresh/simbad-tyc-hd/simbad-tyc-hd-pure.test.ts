import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareOutputs } from '../../util/emit-artifacts';
import { cellReader } from '../pull/columns-pure';
import { bandCheck, spotRowCheck } from '../pull/gates-pure';
import { phaseLimit, runPhasedPull } from '../pull/pull';
import { TapOverflow, textReply } from '../pull/tap-pure';
import { fakeAsk } from '../simbad/simbad-fake-pure';
import { MAIN_ID } from '../simbad/simbad-specs-pure';
import { simbad } from '../simbad/simbad-test-fixtures';
import { parseTyc, tycho2Request } from '../tycho2/tycho2-pure';
import { TYC_HD, TYC_HD_PHASES, TYC_HD_TABLE, hdOrder, tycHdPull, tycHdRows } from './simbad-tyc-hd-pure';

const hds = (oid: number, ...ids: string[]) => new Map([[oid, new Map([[TYC_HD.hd, new Set(ids)]])]]);
const basic = (oid: number, mainId: string) => new Map([[oid, { [MAIN_ID.column]: mainId }]]);

describe('tycHdRows', () => {
  it('ships a resolved TYC whose object holds an HD', () => {
    expect(tycHdRows(['7570-1585-1'], new Map([['7570-1585-1', 1]]), hds(1, '24072'), basic(1, '* f Eri A')))
      .toEqual([['7570-1585-1', '1', '* f Eri A', '24072']]);
  });

  it('ships nothing for an unresolved TYC, or one whose object holds no HD', () => {
    expect(tycHdRows(['1-1-1'], new Map(), new Map(), new Map())).toEqual([]);
    expect(tycHdRows(['1-1-1'], new Map([['1-1-1', 1]]), hds(1), new Map())).toEqual([]);
    expect(tycHdRows(['1-1-1'], new Map([['1-1-1', 1]]), new Map(), new Map())).toEqual([]);
  });

  it('joins every HD an object holds rather than picking one', () => {
    expect(tycHdRows(['1-1-1'], new Map([['1-1-1', 1]]), hds(1, '12448', '12447'), new Map())[0][3]).toBe('12447|12448');
  });

  it('writes a missing main_id as an empty cell', () => {
    expect(tycHdRows(['1-1-1'], new Map([['1-1-1', 1]]), hds(1, '1'), new Map())[0][2]).toBeNull();
  });
});

describe('hdOrder', () => {
  it('orders by number, not text, a bare number before its lettered forms', () => {
    expect(['287782', '35068'].sort(hdOrder)).toEqual(['35068', '287782']);
    expect(['24071B', '24071', '24071A'].sort(hdOrder)).toEqual(['24071', '24071A', '24071B']);
  });
});

describe('the run', () => {
  const pull = (tycs: string[]) => tycHdPull(declareOutputs({ tycHd: 'unused.tsv' }), { request: tycho2Request(tycs, []), requestFrom: [] });

  it('joins SIMBAD\'s padded stored ids back to the request and keeps an HD\'s component letter', async () => {
    const { ask } = fakeAsk(simbad(
      { 6373490: ['TYC   40-1338-1', 'HD  12447', 'HD  12447A'] },
      { 6373490: { oid: '6373490', main_id: '* alf Psc A' } },
    ));
    const result = await pull(['40-1338-1']).run(ask, () => {});
    expect(result.rows.tycHd).toEqual([['40-1338-1', '6373490', '* alf Psc A', '12447|12447A']]);
    expect(result.checks.map((c) => c.kind)).toEqual(['pass']);
  });

  it('refuses a TYC SIMBAD answers under two objects', async () => {
    const { ask } = fakeAsk(simbad({ 1: ['TYC 1-1-1'], 2: ['TYC    1-1-1'] }));
    await expect(pull(['1-1-1']).run(ask, () => {})).rejects.toThrow(/under two objects/);
  });
});

describe('the gates', () => {
  it('a collapsed request falls outside the band', () => {
    expect(bandCheck('tycHd', 12, TYC_HD_TABLE.band).kind).toBe('fail');
  });

  it('a missing or re-attributed spot row fails', () => {
    const cells = (rows: (string | null)[][]) => rows.map(cellReader(TYC_HD_TABLE.columns, 'tycHd'));
    expect(spotRowCheck('tycHd', [], TYC_HD_TABLE.spotRows).kind).toBe('fail');
    const [first] = TYC_HD_TABLE.spotRows;
    const drifted = cells([[first.value, '1', first.cells[TYC_HD.mainId] as string, '999999']]);
    expect(spotRowCheck('tycHd', drifted, [first]).kind).toBe('fail');
  });

  it('every pinned row is keyed on a TYC the request can hold', () => {
    for (const spot of TYC_HD_TABLE.spotRows) expect(parseTyc(spot.value)).not.toBeNull();
  });
});

describe('an overflowed SIMBAD reply', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tyc-hd-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('raises, and writes nothing', async () => {
    const overfull = `oidref,id\n${Array.from({ length: phaseLimit(TYC_HD_PHASES.resolve) + 1 }, (_, i) => `${i},TYC 1-${i}-1`).join('\n')}\n`;
    const pull = tycHdPull(declareOutputs({ tycHd: join(dir, 'tyc-hd.tsv') }), { request: tycho2Request(['1-1-1'], []), requestFrom: [] });
    await expect(runPhasedPull(pull, {
      transport: async (_url, form) => (form ? textReply(200, 'text/csv', overfull) : textReply(200, 'text/xml', '<capabilities/>')),
      sleep: async () => {},
      report: () => {},
      log: () => {},
    })).rejects.toThrow(TapOverflow);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tsv'))).toEqual([]);
  });
});
