import { describe, expect, it } from 'vitest';

import { parseGlieseTsv } from '../gliese-parse';
import type { Tycho2Row } from '../tycho2-parse';
import { SPINE_COLUMNS, type SpineRow } from './inherited-spine-pure';
import {
  ATHYG_HD_LINK_FLOOR,
  attestSpineRow,
  auditSpine,
  checkIdentity,
  findAdditions,
  formatAuditReport,
  spineKeys,
  type PrimaryTables,
} from './primaries-audit-pure';

function row(cells: Partial<SpineRow>): SpineRow {
  const out = {} as SpineRow;
  for (const c of SPINE_COLUMNS) out[c] = cells[c] ?? '';
  return out;
}

function tycho2(vtMag: number): Tycho2Row {
  return {
    raDeg: 0, decDeg: 0, epoch: 2000, pmRaMasyr: null, pmDecMasyr: null,
    btMag: null, vtMag, fromIcrs: false, isPhotocentre: false,
  };
}

const GLIESE_TSV = [
  'name\tcomp\tvmag\tbv\tsp\tplx_mas\te_plx_mas\tn_plx',
  'NN 3001\t\t12.1\t\t\t\t\t',
  'Gl 165\tAB\t9.0\t\t\t\t\t',
].join('\n') + '\n';

const tables: PrimaryTables = {
  iv25: [
    { tyc: '1-1-1', hd: 100001, nHd: 1, nTyc: 1 },
    { tyc: '1-2-1', hd: 5, nHd: 1, nTyc: 1 },
    { tyc: '9-9-1', hd: 200000, nHd: 2, nTyc: 1 },
    { tyc: '9-8-1', hd: 40, nHd: 1, nTyc: 1 },
  ],
  v50: [
    { hr: 1, hd: 100001, name: null },
    { hr: 9999, hd: null, name: 'NGC 1' },
    { hr: 50, hd: 123456, name: null },
  ],
  iv27a: [
    { hd: 100001, hip: 10, bayer: 'alf', flamsteed: 1, cst: 'And' },
    { hd: 123456, hip: null, bayer: 'bet', flamsteed: null, cst: 'Cas' },
  ],
  cns5: [
    { cns5: 1, gj: '551.0', gjComp: null, gaiaSourceId: '555', hip: 70890, astrometry: null },
    { cns5: 2, gj: '423', gjComp: 'AB', gaiaSourceId: null, hip: null, astrometry: null },
    { cns5: 0, gj: 'Sun', gjComp: null, gaiaSourceId: null, hip: null, astrometry: null },
  ],
  gliese: parseGlieseTsv(GLIESE_TSV),
  hipI239: new Set([10, 20, 70890]),
  wgsn: { names: new Set(['Alpheratz']), hd: new Set<number>(), hip: new Set<number>() },
  tycho2: new Map([['1-1-1', tycho2(8.5)], ['1-2-1', tycho2(10.2)], ['9-9-1', tycho2(11.7)]]),
  tycToSource: new Map([['1-1-1', '111'], ['1-2-1', '222'], ['9-9-1', '999']]),
  hipToSource: new Map([[10, '111'], [20, '333']]),
  simbadBySourceId: new Map([
    ['999', { hip: 20, tyc: null, gj: null }],
    ['777', { hip: 21, tyc: '5-5-5', gj: null }],
    ['666', { hip: null, tyc: null, gj: null }],
    ['444', { hip: null, tyc: null, gj: 'GJ 3239' }],
  ]),
};

const fullyAttested = row({
  tyc: '1-1-1', hip: '10', hd: '100001', hr: '1', bayer: 'Alp', flam: '1',
  proper: 'Alpheratz', gaia_source_id: '111',
});
const athygOnly = row({ hd: '77777', gaia_source_id: '' });
const cns5Star = row({ gl: 'Gl 551', gaia_source_id: '555' });
const glieseStar = row({ gl: 'GJ 3001', hip: '20', gaia_source_id: '999' });
const sol = row({ proper: 'Sol' });
const noGaia = row({ tyc: '1-2-1', hd: '5' });
const rows = [fullyAttested, athygOnly, cns5Star, glieseStar, sol, noGaia];

describe('attestSpineRow', () => {
  it('names the primary behind every cell of a fully attested row', () => {
    const a = attestSpineRow(fullyAttested, tables);
    expect(a.attestation).toEqual({
      hd: 'iv25', hr: 'v50', hip: 'i239', gl: null, bayerFlam: 'iv27a', proper: 'wgsn', tyc: 'tycho2',
    });
    expect(a.unattested).toEqual([]);
    expect(a.residual).toBe(false);
  });

  it('marks a row whose only designation no primary carries as residual', () => {
    const a = attestSpineRow(athygOnly, tables);
    expect(a.carried).toEqual(['hd']);
    expect(a.unattested).toEqual(['hd']);
    expect(a.residual).toBe(true);
  });

  it('attests a Gliese cell through CNS5 first, then V/70A, folding CNS5\'s trailing .0', () => {
    expect(attestSpineRow(cns5Star, tables).attestation.gl).toBe('cns5');
    expect(attestSpineRow(glieseStar, tables).attestation.gl).toBe('v70a');
    expect(attestSpineRow(row({ gl: 'Gl 165A' }), tables).attestation.gl).toBe('v70a');
  });

  it('attests Sol by name and an HD that only V/50 carries by V/50', () => {
    expect(attestSpineRow(sol, tables).attestation.proper).toBe('sol');
    expect(attestSpineRow(row({ hd: '123456' }), tables).attestation.hd).toBe('v50');
  });

  it('is not residual on an empty row, which carries no claim to attest', () => {
    const a = attestSpineRow(row({}), tables);
    expect(a.carried).toEqual([]);
    expect(a.residual).toBe(false);
  });
});

describe('checkIdentity', () => {
  it('agrees where any raw route reproduces the spine cell, naming the routes', () => {
    const c = checkIdentity(fullyAttested, tables);
    expect(c.verdict).toBe('agree');
    expect(c.agreeing).toEqual(['tyc', 'hip']);
    expect(checkIdentity(cns5Star, tables).agreeing).toEqual(['cns5']);
  });

  it('disagrees where a route binds a different source, and asks SIMBAD', () => {
    const c = checkIdentity(glieseStar, tables);
    expect(c.verdict).toBe('disagree');
    expect(c.viaHip).toBe('333');
    expect(c.simbad).toBe('corroborates');
    expect(c.gaiaKeyed).toBe(false);
    expect(checkIdentity(fullyAttested, tables).simbad).toBeNull();
  });

  it('grades an unreachable binding by what SIMBAD hangs on the id', () => {
    const contradicted = checkIdentity(row({ tyc: '3-3-3', hip: '30', gaia_source_id: '777' }), tables);
    expect(contradicted.verdict).toBe('unreachable');
    expect(contradicted.simbad).toBe('contradicts');
    expect(checkIdentity(row({ tyc: '3-3-3', gaia_source_id: '666' }), tables).simbad).toBe('no_crossid');
    const gaiaOnly = checkIdentity(row({ flam: '9', gaia_source_id: '000' }), tables);
    expect(gaiaOnly.simbad).toBe('no_object');
    expect(gaiaOnly.gaiaKeyed).toBe(true);
  });

  it('corroborates a component GJ against SIMBAD\'s system entry on the bare number', () => {
    expect(checkIdentity(row({ gl: 'GJ 3239A', gaia_source_id: '444' }), tables).simbad)
      .toBe('corroborates');
    expect(checkIdentity(row({ gl: 'Gl 157.1', gaia_source_id: '444' }), tables).simbad)
      .toBe('contradicts');
  });

  it('separates the empty-cell rows by whether a walk would bind one', () => {
    expect(checkIdentity(noGaia, tables).verdict).toBe('no_spine_id_walk_binds');
    expect(checkIdentity(athygOnly, tables).verdict).toBe('no_spine_id_unreachable');
    expect(checkIdentity(sol, tables).verdict).toBe('sol');
  });
});

describe('findAdditions', () => {
  const additions = findAdditions(tables, spineKeys(rows));

  it('lists IV/25 stars whose TYC is no spine row, with Tycho-2 and DR3 reach', () => {
    expect(additions.hd.map((a) => a.tyc)).toEqual(['9-8-1', '9-9-1']);
    expect(additions.hd[1]).toEqual({
      tyc: '9-9-1', hds: [200000], ambiguous: true, vtMag: 11.7, inTycho2: true, gaiaSourceId: '999',
    });
    expect(additions.hd[0].inTycho2).toBe(false);
    expect(additions.hdOnExistingRecord).toBe(0);
  });

  it('lists the I/239, CNS5, IV/27A and V/50 entries no spine cell reaches', () => {
    expect(additions.hip).toEqual([{ hip: 70890, gaiaSourceId: null }]);
    expect(additions.cns5.newRecords.map((r) => r.gj)).toEqual(['423']);
    expect(additions.cns5.onExistingRecord).toBe(0);
    expect(additions.iv27a.map((r) => r.hd)).toEqual([123456]);
    expect(additions.v50.map((r) => r.hr)).toEqual([9999, 50]);
  });

  it('counts an IV/25 HD landing on an existing spine TYC as a label event, not a record', () => {
    const withOtherHd = spineKeys([...rows, row({ tyc: '9-9-1', hd: '4444' })]);
    const a = findAdditions(tables, withOtherHd);
    expect(a.hd.map((x) => x.tyc)).toEqual(['9-8-1']);
    expect(a.hdOnExistingRecord).toBe(1);
  });
});

describe('auditSpine', () => {
  const result = auditSpine(rows, tables);

  it('tallies the residual, the partial rows and the identity verdicts', () => {
    expect(result.summary.rows).toBe(6);
    expect(result.summary.residual).toBe(1);
    expect(result.summary.partiallyUnattested).toBe(0);
    expect(result.summary.identity).toEqual({
      sol: 1, agree: 2, disagree: 1, unreachable: 0,
      no_spine_id_walk_binds: 1, no_spine_id_unreachable: 1,
    });
    expect(result.summary.identityAgreeingRoutes).toEqual({ 'tyc+hip': 1, cns5: 1 });
    expect(result.summary.unreproduced).toEqual({
      total: 1, simbad: { corroborates: 1, contradicts: 0, no_object: 0, no_crossid: 0 }, gaiaKeyed: 0,
    });
    expect(result.unreproduced.map((u) => u.row.gl)).toEqual(['GJ 3001']);
    expect(result.summary.attestedBy).toEqual({
      'hd:iv25': 2, 'hr:v50': 1, 'hip:i239': 2, 'gl:cns5': 1, 'gl:v70a': 1,
      'bayerFlam:iv27a': 1, 'proper:wgsn': 1, 'proper:sol': 1,
    });
  });

  it('summarises the additions with the HD-number band the AT-HYG link missed', () => {
    const a = result.summary.additions;
    expect(a.hdRecords).toBe(2);
    expect(a.hdBelowLinkFloor).toBe(1);
    expect(ATHYG_HD_LINK_FLOOR).toBe(100_000);
    expect(a.hdVtHistogram).toEqual({ none: 1, '11': 1 });
    expect(a.v50HdLess).toBe(1);
  });

  it('renders every headline count in the report', () => {
    const report = formatAuditReport(result.summary);
    expect(report).toContain('residual (no classical cell attested by any primary): 1');
    expect(report).toContain('IV/25 HD stars (by TYC): 2  (HD < 100000: 1');
  });
});
