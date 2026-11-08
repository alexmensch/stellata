import { describe, expect, it } from 'vitest';

import {
  countFilled, fillLine, floorCheck, fluxBlock, identBlock, isFilled, simbadColumns, simbadRows,
} from './simbad-rows-pure';
import {
  BASIC_BIBCODED_GROUPS, GAIA_DR3, HIP, OID, OTYPE, PLX_BIBCODE, PLX_ERR, PLX_QUAL, PLX_VALUE,
  RVZ_BIBCODE, RVZ_ERR, RVZ_QUAL, RVZ_RADVEL, RVZ_TYPE, SP_TYPE, fluxGroup,
} from './simbad-specs-pure';

const V = { filter: 'V' };
const idents = (rows: Record<number, Record<string, string>>) =>
  identBlock([HIP, GAIA_DR3], new Map(Object.entries(rows).map(([oid, cells]) => [Number(oid), new Map(Object.entries(cells))])));
const flux = (rows: Record<number, Record<string, string | null>>, bands = [V]) =>
  fluxBlock(bands, new Map(Object.entries(rows).map(([oid, cells]) => [Number(oid), cells])));

describe('simbadColumns', () => {
  it('writes the basic columns, then each block in order', () => {
    expect(simbadColumns([OID, SP_TYPE, OTYPE], [idents({}), flux({})]).map((c) => c.name)).toEqual([
      'simbad_oid', 'sp_type', 'otype', 'hip', 'source_id', 'flux_V', 'flux_V_err', 'flux_V_bibcode',
    ]);
  });
});

describe('simbadRows', () => {
  it('merges basic cells and blocks per oid, in the order given', () => {
    expect(simbadRows([42, 7], new Map([[42, { sp_type: 'G2V' }]]), [OID, SP_TYPE], [idents({ 42: { hip: '7', source_id: '99' } })]))
      .toEqual([['42', 'G2V', '7', '99'], ['7', null, null, null]]);
  });

  it('drops a flux value and its error where the band\'s bibcode is empty or blank', () => {
    const rows = simbadRows([1, 2, 3], new Map(), [OID], [flux({
      1: { flux_V: '7.34', flux_V_err: '0.01', flux_V_bibcode: null },
      2: { flux_V: '7.34', flux_V_err: '0.01', flux_V_bibcode: '   ' },
      3: { flux_V: '7.34', flux_V_err: '0.01', flux_V_bibcode: '2000A&A..1H' },
    })], [fluxGroup(V)]);
    expect(rows).toEqual([
      ['1', null, null, null], ['2', null, null, '   '], ['3', '7.34', '0.01', '2000A&A..1H'],
    ]);
  });

  it('takes a basic-table quantity down whole, leaving a bibcoded one alone', () => {
    const columns = [OID, PLX_VALUE, PLX_ERR, PLX_QUAL, PLX_BIBCODE, RVZ_RADVEL, RVZ_ERR, RVZ_TYPE, RVZ_QUAL, RVZ_BIBCODE] as const;
    const basic = new Map([[1, {
      plx_value: '12.3', plx_err: '0.4', plx_qual: 'A', plx_bibcode: null,
      rvz_radvel: '-5.0', rvz_err: '0.2', rvz_type: 'v', rvz_qual: 'B', rvz_bibcode: '2006AstL...32..759G',
    }]]);
    const groupsOnRows = BASIC_BIBCODED_GROUPS.filter((g) => columns.some((c) => c.tsv === g.bibcode));
    expect(simbadRows([1], basic, columns, [], groupsOnRows)).toEqual([
      ['1', null, null, null, null, '-5.0', '0.2', 'v', 'B', '2006AstL...32..759G'],
    ]);
  });

  it('refuses a group naming a column the table does not write', () => {
    expect(() => simbadRows([1], new Map(), [OID], [], [fluxGroup(V)])).toThrow(/flux_V_bibcode, which the table does not write/);
  });
});

describe('fill gates', () => {
  const cells = [{ sp_type: 'G2V' }, { sp_type: '   ' }, { sp_type: null }, {}] as { sp_type?: string | null }[];

  it('counts a blank and an absent cell alike as unfilled', () => {
    expect([' ', '', null, undefined, 'x'].map(isFilled)).toEqual([false, false, false, false, true]);
    expect(countFilled(cells, (c) => isFilled(c.sp_type))).toBe(1);
  });

  it('prints a fill as count over total and a percentage', () => {
    expect(fillLine('sp_type', 1, 4)).toBe('  sp_type               1/4 = 25.0%');
  });

  it('fails below the floor and passes at it', () => {
    expect(floorCheck('sp_type coverage', 0.49, 0.5, 'the shape drifted')).toEqual({
      kind: 'fail', message: 'sp_type coverage 49.0%, floor 50%: the shape drifted; investigate before pinning',
    });
    expect(floorCheck('sp_type coverage', 0.5, 0.5, 'the shape drifted')).toEqual({ kind: 'pass', report: 'sp_type coverage 50.0%, floor 50%' });
  });
});
