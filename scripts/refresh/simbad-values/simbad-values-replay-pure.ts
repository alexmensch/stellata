// A fake SIMBAD holding a committed simbad_values.tsv's objects, for the replay. See README.md#the-committed-table.

import type { FakeSimbad } from '../simbad/simbad-fake-pure';
import { compose, fluxColumns } from '../simbad/simbad-specs-pure';
import { readTable } from '../../util/tsv/table-pure';
import { BASIC, FLUX_BANDS, IDENTS } from './simbad-values-pure';

/** Each row's basic cells, its one id per namespace, and its bibcoded fluxes: what the pull wrote is all SIMBAD holds. */
export function valuesFake(text: string, file: string): FakeSimbad {
  const fluxNames = FLUX_BANDS.flatMap((b) => fluxColumns(b).map((c) => c.tsv));
  const columns = [...BASIC.map((c) => c.tsv), ...IDENTS.map((ns) => ns.name), ...fluxNames];
  const idents: { oid: number; id: string }[] = [];
  const basic = new Map<number, Record<string, string | null>>();
  const flux: NonNullable<FakeSimbad['flux']>[number][] = [];
  for (const row of readTable({ file, columns, hint: 'Replay a committed values pull.' }, text)) {
    const cell = (c: string): string | null => row.raw(c) || null;
    const oid = row.int(BASIC[0].tsv) ?? row.fail('no simbad_oid');
    basic.set(oid, Object.fromEntries(BASIC.map((c) => [c.column, c === BASIC[0] ? String(oid) : cell(c.tsv)])));
    for (const ns of IDENTS) {
      const suffix = cell(ns.name);
      if (suffix !== null) idents.push({ oid, id: compose(ns, suffix) });
    }
    for (const band of FLUX_BANDS) {
      const [value, err, bibcode] = fluxColumns(band).map((c) => cell(c.tsv));
      if (value !== null || err !== null || bibcode !== null) flux.push({ oid, filter: band.filter, flux: value, fluxErr: err, bibcode });
    }
  }
  return { idents, basic, flux };
}
