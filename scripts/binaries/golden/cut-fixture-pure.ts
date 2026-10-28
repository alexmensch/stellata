// Cut multiples.tsv and the catalogue row-index map down to the golden's WDS systems. See README.md.

import type { CatalogRowIndexMap } from '../../catalog/companions/record-index/record-index';
import type { MultiplesRecord } from '../multiples-tsv';

export const FIXTURE_SYSTEMS: readonly string[] = [
  '00003-4417', '00004+7305', '00005+2031', '00006-5306', '00008+1659', '00012+1357',
  '00017+5905', '00022+5958', '00023+3257', '00024+1047', '00026+5942', '00047+3416',
  '00091+4051', '00109+4807', '00121+5337', '00124+4558', '03082+4057', '04049-3527',
  '05353-0523', '07031+5410', '07346+3153', '08122+1739', '12266-6306', '18025+4414',
];

export function wdsIdOf(systemId: string): string {
  return systemId.slice(0, systemId.lastIndexOf('-'));
}

export function cutMultiples(
  records: readonly MultiplesRecord[], systems: readonly string[],
): MultiplesRecord[] {
  const keep = new Set(systems);
  return records.filter((r) => keep.has(wdsIdOf(r.systemId)));
}

function pick(table: Readonly<Record<string, number>>, keys: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of [...new Set(keys)].sort()) {
    if (key in table) out[key] = table[key];
  }
  return out;
}

export function cutRowIndexMap(
  map: CatalogRowIndexMap, records: readonly MultiplesRecord[], systems: readonly string[],
): CatalogRowIndexMap {
  const synthPrefixes = systems.map((wds) => `synth-${wds}-`);
  return {
    byGaia: pick(map.byGaia, records.flatMap((r) => (r.gaiaSourceId === null ? [] : [r.gaiaSourceId]))),
    byHip: pick(map.byHip, records.flatMap((r) => (r.hip === null ? [] : [String(r.hip)]))),
    bySynth: pick(map.bySynth, Object.keys(map.bySynth).filter((k) => synthPrefixes.some((p) => k.startsWith(p)))),
  };
}
