// The SIMBAD TYC → HD pull: each mentioned Tycho entry's SIMBAD object, its main_id and every HD it holds. See README.md.

import { ascending, compareCodeUnits } from '../../../src/astro-core/order-pure';
import { percentOf } from '../../util/counts/tally-pure';
import type { DeclaredOutputs } from '../../util/emit-artifacts';
import { cellReader, type Column, type Row } from '../pull/columns-pure';
import type { Phase, PhasedPull, WrittenTable } from '../pull/pull';
import { SIMBAD } from '../pull/tap-pure';
import { fetchBasic, fetchIdentSets, parseLedger, resolveOids, simbadPhases, type BasicCells } from '../simbad/simbad-fetch-pure';
import { HD_LETTERED, MAIN_ID, OID, TYC } from '../simbad/simbad-specs-pure';
import { requestLines, type Tycho2Inputs } from '../tycho2/tycho2-pure';

const CORE = simbadPhases({ basic: [OID, MAIN_ID], idents: [HD_LETTERED] });

export const TYC_HD_PHASES = { resolve: CORE.resolve, idents: CORE.idents, basic: CORE.basic } as const satisfies Record<string, Phase>;

/** The written columns' names; `TYC_HD_COLUMNS` is their order. */
export const TYC_HD = { tyc: 'tyc', oid: OID.tsv, mainId: MAIN_ID.tsv, hd: HD_LETTERED.name } as const;

const TYC_HD_COLUMNS: readonly [Column, ...Column[]] = [{ name: TYC_HD.tyc }, { name: TYC_HD.oid }, { name: TYC_HD.mainId }, { name: TYC_HD.hd }];

const spot = (tyc: string, hd: string, mainId: string) => ({ key: TYC_HD.tyc, value: tyc, cells: { [TYC_HD.hd]: hd, [TYC_HD.mainId]: mainId } });

/** README.md#gates. */
export const TYC_HD_TABLE: WrittenTable = {
  columns: TYC_HD_COLUMNS,
  sortBy: [{ column: TYC_HD.tyc, as: 'text' }],
  band: { min: 300_000, max: 380_000 },
  spotRows: [
    spot('7570-1585-1', '24072', '* f Eri A'),
    spot('7570-1586-1', '24071', '* f Eri B'),
    spot('5675-662-1', '164765', '* tau Oph A'),
    spot('5675-662-2', '164764', '* tau Oph B'),
    spot('40-1338-1', '12447', '* alf Psc A'),
    spot('2019-1250-1', '129988', '* eps Boo B'),
    spot('7902-891-1', '170867', '* kap02 CrA'),
    spot('7902-1905-1', '170868', '* kap01 CrA'),
  ],
};

const leadingNumber = (hd: string): number => {
  const lead = /^\d+/.exec(hd);
  return lead === null ? -1 : Number(lead[0]);
};

/** By the HD number, then the whole suffix, so a pair's two numbers read adjacently whatever their widths and a bare number precedes its lettered forms. */
export const hdOrder = (a: string, b: string): number => leadingNumber(a) - leadingNumber(b) || compareCodeUnits(a, b);

/** One row per TYC that resolved to an object holding an HD: README.md#the-table. */
export function tycHdRows(
  tycs: readonly string[], oidByTyc: ReadonlyMap<string, number>,
  hdsByOid: ReadonlyMap<number, ReadonlyMap<string, ReadonlySet<string>>>, basic: ReadonlyMap<number, BasicCells>,
): Row[] {
  const rows: Row[] = [];
  for (const tyc of tycs) {
    const oid = oidByTyc.get(tyc);
    if (oid === undefined) continue;
    const hds = hdsByOid.get(oid)?.get(HD_LETTERED.name);
    if (hds === undefined || hds.size === 0) continue;
    rows.push([tyc, String(oid), basic.get(oid)?.[MAIN_ID.column] ?? null, [...hds].sort(hdOrder).join('|')]);
  }
  return rows;
}

export function tycHdPull(outputs: DeclaredOutputs<'tycHd'>, { request, requestFrom }: Tycho2Inputs): PhasedPull<'tycHd'> {
  const tycs = requestLines(request);
  return {
    archive: SIMBAD,
    outputs,
    phases: TYC_HD_PHASES,
    tables: { tycHd: TYC_HD_TABLE },
    request: { request: tycs, requestFrom },
    async run(ask, log) {
      log(`request set: ${tycs.length} Tycho ids (IV/25, the manifest and every Tycho-2 pair's entries)`);
      const ledger = parseLedger();
      const oidByTyc = await resolveOids(ask, CORE, TYC, tycs, ledger);
      log(`resolved ${oidByTyc.size}/${tycs.length} (${percentOf(oidByTyc.size, tycs.length)}) to a SIMBAD oid`);
      const oids = [...new Set(oidByTyc.values())].sort(ascending);
      const hds = await fetchIdentSets(ask, CORE.idents, oids, ledger);
      const basic = await fetchBasic(ask, CORE, oids);
      const rows = tycHdRows(tycs, oidByTyc, hds, basic);
      log(`rows: ${rows.length}, ${rows.map(cellReader(TYC_HD_COLUMNS, 'tycHd')).filter((cell) => cell(TYC_HD.hd)?.includes('|')).length} carrying more than one HD`);
      return { rows: { tycHd: rows }, checks: [ledger.check('idents')] };
    },
  };
}
