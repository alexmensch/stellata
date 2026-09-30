// Cut multiples.tsv and the catalogue row-index map down to the golden's WDS systems. See README.md.

import type { CatalogRowIndexMap } from '../../catalog/companions/record-index/record-index';

export const FIXTURE_SYSTEMS: readonly string[] = [
  '00003-4417', '00004+7305', '00005+2031', '00006-5306', '00008+1659', '00012+1357',
  '00017+5905', '00022+5958', '00023+3257', '00024+1047', '00026+5942', '00047+3416',
  '00091+4051', '00109+4807', '00121+5337', '00124+4558', '03082+4057', '04049-3527',
  '05353-0523', '07031+5410', '07346+3153', '08122+1739', '12266-6306', '18025+4414',
];

export function wdsIdOf(systemId: string): string {
  return systemId.slice(0, systemId.lastIndexOf('-'));
}

export function cutMultiples(tsv: string, systems: readonly string[]): string {
  const keep = new Set(systems);
  const [header, ...rows] = tsv.split('\n').filter((line) => line !== '');
  const kept = rows.filter((row) => keep.has(wdsIdOf(row.split('\t', 1)[0])));
  return [header, ...kept].map((line) => `${line}\n`).join('');
}

function pick(table: Readonly<Record<string, number>>, keys: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of [...new Set(keys)].sort()) {
    if (key in table) out[key] = table[key];
  }
  return out;
}

export function cutRowIndexMap(
  map: CatalogRowIndexMap, fixtureTsv: string, systems: readonly string[],
): CatalogRowIndexMap {
  const [header, ...rows] = fixtureTsv.split('\n').filter((line) => line !== '').map((l) => l.split('\t'));
  const column = (name: string) => rows.map((cells) => cells[header.indexOf(name)]).filter((c) => c !== '');
  const synthPrefixes = systems.map((wds) => `synth-${wds}-`);
  return {
    byGaia: pick(map.byGaia, column('gaia_source_id')),
    byHip: pick(map.byHip, column('hip')),
    bySynth: pick(map.bySynth, Object.keys(map.bySynth).filter((k) => synthPrefixes.some((p) => k.startsWith(p)))),
  };
}
