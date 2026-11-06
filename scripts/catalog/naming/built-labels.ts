// Every built record's displayed label, read off the naming lineage and joined to its record index through its SID. See README.md#the-parity-ledger.

import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { Catalog } from '../catalog-lookup';
import { readLineage } from '../lineage/lineage-io';
import { allocationSids } from '../../sid/allocation-lineage-pure';
import { namingLabels } from './naming-lineage-pure';
import {
  ALLOCATION_SIDS_STEM, NAMING_LINEAGE, stageFile,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export function builtLabelFiles(lineageDir: string): string[] {
  return [stageFile(lineageDir, NAMING_LINEAGE.stage), stageFile(lineageDir, ALLOCATION_SIDS_STEM)];
}

export function builtLabelsReady(lineageDir: string): boolean {
  return builtLabelFiles(lineageDir).every(existsSync);
}

/** Indexed by record; `null` for an unlabelled record. Throws on a record
 *  whose SID or origin key the lineage does not carry, so a catalogue and a
 *  lineage from two builds never pair silently. */
export function builtLabels(catalog: Catalog, lineageDir: string): (string | null)[] {
  const [namingPath, sidsPath] = builtLabelFiles(lineageDir);
  const keyBySid = new Map<number, string>();
  for (const { key, sid } of allocationSids(gunzipSync(readFileSync(sidsPath)).toString('utf8'), sidsPath)) {
    keyBySid.set(sid, key);
  }
  const labelByKey = namingLabels(readLineage(namingPath));
  const out: (string | null)[] = [];
  for (const r of catalog.records()) {
    const key = keyBySid.get(r.sid);
    const label = key === undefined ? undefined : labelByKey.get(key);
    if (label === undefined) {
      throw new Error(`record ${r.i} (SID ${r.sid}) has no naming row in ${lineageDir}: rebuild the catalogue`);
    }
    out.push(label);
  }
  return out;
}
