// Fixtures the SIMBAD suites share: a manifest record with named cells set, and a fake SIMBAD built from per-object ids.

import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import type { FakeSimbad } from './simbad-fake-pure';

export function record(cells: Partial<ManifestRecord> = {}): ManifestRecord {
  return {
    tyc: null, hip: null, hd: null, hdAlt: [], hr: null, hrAlt: [], gl: null, flam: null, bayer: null, proper: null,
    gaiaSourceId: null, binding: 'none', routes: '', term: 'primaries', originKey: 'test', isSol: false, ...cells,
  };
}

/** A fake SIMBAD holding `ids` per oid and `basic` cells per oid. */
export function simbad(
  ids: Readonly<Record<number, readonly string[]>>, basic: Readonly<Record<number, Readonly<Record<string, string | null>>>> = {},
): FakeSimbad {
  return {
    idents: Object.entries(ids).flatMap(([oid, list]) => list.map((id) => ({ oid: Number(oid), id }))),
    basic: new Map(Object.entries(basic).map(([oid, cells]) => [Number(oid), cells])),
  };
}
