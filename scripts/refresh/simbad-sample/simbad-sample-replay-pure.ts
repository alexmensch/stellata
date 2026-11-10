// A fake SIMBAD that answers the sample pull with a committed simbad_sample.tsv's own rows, for the replay. See README.md#the-committed-table.

import type { Row } from '../pull/columns-pure';
import type { Phase } from '../pull/pull';
import type { FakeSimbad } from '../simbad/simbad-fake-pure';
import { compose, GAIA_DR3, HIP } from '../simbad/simbad-specs-pure';
import { readTable } from '../../util/tsv/table-pure';
import { BINS, BIN_PHASES } from './simbad-sample-pure';

const COLUMNS = [
  'simbad_oid', 'simbad_main_id', 'hip', 'gaia_source_id', 'ra', 'dec', 'plx_value', 'plx_err', 'pmra', 'pmdec',
  'v_mag', 'distance_pc', 'absmag', 'sp_type', 'otype',
] as const;

/** Each bin's candidates are exactly the table's rows whose V falls in it, so the draw takes every one. */
export function sampleFake(text: string, file: string): FakeSimbad {
  const candidates = BINS.map((): Row[] => []);
  const idents: { oid: number; id: string }[] = [];
  for (const row of readTable({ file, columns: COLUMNS, hint: 'Replay a committed sample.' }, text)) {
    const cell = (c: (typeof COLUMNS)[number]): string | null => row.raw(c) || null;
    const v = Number(row.raw('v_mag'));
    const bin = BINS.findIndex((b) => (b.vMin === null || v >= b.vMin) && v < b.vMax);
    if (bin < 0) row.fail(`v_mag ${v} falls in no bin`);
    const oid = cell('simbad_oid') as string;
    candidates[bin].push([
      oid, cell('simbad_main_id'), cell('ra'), cell('dec'), cell('plx_value'), cell('plx_err'),
      cell('pmra'), cell('pmdec'), cell('otype'), cell('sp_type'), cell('v_mag'),
    ]);
    const hip = cell('hip');
    const gaia = cell('gaia_source_id');
    if (hip !== null) idents.push({ oid: Number(oid), id: compose(HIP, hip) });
    if (gaia !== null) idents.push({ oid: Number(oid), id: compose(GAIA_DR3, gaia) });
  }
  return { idents, basic: new Map(), wholeTables: new Map<Phase, Row[]>(BIN_PHASES.map((phase, i) => [phase, candidates[i]])) };
}
