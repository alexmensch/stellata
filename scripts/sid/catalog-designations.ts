// Designation set per BUILT catalog record, assembled from the artifacts in
// public/. See README.md § Designation extraction.

import type { Catalog } from '../catalog/catalog-lookup';
import { FLAG_IS_SOL, type SearchEntry } from '../catalog/catalog-pure';
import { starDesignations } from './sid-pure';

export interface CatalogRecordDesignations {
  i: number;
  flags: number;
  name: string | null;
  designations: string[];
}

export function catalogRecordDesignations(
  catalog: Catalog,
  searchIndex: readonly SearchEntry[],
  bySynth: Readonly<Record<string, number>>,
): CatalogRecordDesignations[] {
  const hd = new Map<number, number>();
  const hr = new Map<number, number>();
  const hdAlt = new Map<number, number[]>();
  const hrAlt = new Map<number, number[]>();
  const gl = new Map<number, string>();
  for (const e of searchIndex) {
    if (e.hd !== undefined) hd.set(e.i, e.hd);
    if (e.hr !== undefined) hr.set(e.i, e.hr);
    if (e.hda !== undefined) hdAlt.set(e.i, e.hda);
    if (e.hra !== undefined) hrAlt.set(e.i, e.hra);
    if (e.gl !== undefined) gl.set(e.i, e.gl);
  }
  const synthByIndex = new Map<number, string>();
  for (const [key, i] of Object.entries(bySynth)) synthByIndex.set(i, key);

  const records: CatalogRecordDesignations[] = [];
  for (const r of catalog.records()) {
    records.push({
      i: r.i,
      flags: r.flags,
      name: r.name,
      designations: starDesignations({
        isSol: (r.flags & FLAG_IS_SOL) !== 0,
        hip: r.hip,
        hd: hd.get(r.i) ?? null,
        hr: hr.get(r.i) ?? null,
        hdAlt: hdAlt.get(r.i) ?? [],
        hrAlt: hrAlt.get(r.i) ?? [],
        gl: gl.get(r.i) ?? null,
        gaiaSourceId: r.gaiaSourceId !== null ? r.gaiaSourceId.toString() : null,
        syntheticId: synthByIndex.get(r.i) ?? null,
      }),
    });
  }
  return records;
}
