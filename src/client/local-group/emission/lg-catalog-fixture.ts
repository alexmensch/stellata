// The shipped Local Group catalogue assembled from data/ the way
// build-local-group.ts does, for the emission suites (no public/ artifact).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLvdb, parseOverrides } from '../../../../scripts/local-group/build-local-group';
import {
  buildStandaloneOverride,
  filterForRendering,
  mergeRowAndOverride,
  type LgObject as BuildLgObject,
} from '../../../../scripts/local-group/build-local-group-pure';

export type { BuildLgObject };

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', '..', 'data', 'local-group');
const lvdb = parseLvdb(readFileSync(join(dataDir, 'lvdb-snapshot.csv'), 'utf8'));
export const overrides = parseOverrides(readFileSync(join(dataDir, 'overrides.tsv'), 'utf8'));
const overrideByName = new Map(overrides.map((o) => [o.name, o]));
const renderable = filterForRendering(lvdb);

export function buildObject(name: string): BuildLgObject {
  const row = renderable.find((r) => r.name === name);
  if (row) return mergeRowAndOverride(row, overrideByName.get(name))!;
  return buildStandaloneOverride(overrideByName.get(name)!)!;
}

/** Every renderable LVDB row, then the standalone override rows LVDB does
 *  not carry (M31, M33). */
export const ALL_OBJECTS: BuildLgObject[] = (() => {
  const out: BuildLgObject[] = [];
  const matched = new Set<string>();
  for (const row of renderable) {
    const merged = mergeRowAndOverride(row, overrideByName.get(row.name));
    if (!merged) continue;
    if (merged.source === 'OVERRIDE') matched.add(row.name);
    out.push(merged);
  }
  for (const ov of overrides) {
    if (matched.has(ov.name)) continue;
    const built = buildStandaloneOverride(ov);
    if (built) out.push(built);
  }
  return out;
})();
