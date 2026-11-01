// The SID objects of the built artifacts, in allocation order: catalogue records, sibling-layer objects, then the sol and shell lists.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_CATALOG_MANIFEST,
  DEFAULT_CONSTELLATIONS_JSON,
  DEFAULT_ROW_INDEX_MAP,
  DEFAULT_SEARCH_INDEX,
  loadCatalog,
} from '../catalog/catalog-lookup';
import { FLAG_IS_SOL, type SearchEntry } from '../catalog/record/catalog-pure';
import { REPO_ROOT } from '../util/paths';
import { catalogRecordDesignations } from './catalog-designations';
import { SHELL_OBJECTS, SOL_OBJECTS } from './object-mints-source';
import type { SidObject } from './sid-pure';
import { SIBLING_ARTIFACTS, siblingArtifactObjects, type SiblingItem } from './sibling-artifacts';

const CATALOG_HINT = 'run pnpm run build:catalog';

const SIBLING_PATHS = Object.values(SIBLING_ARTIFACTS).map((spec) => ({
  spec, path: resolve(REPO_ROOT, 'public', spec.file),
}));

/** The built files `builtObjects` reads at fixed paths; the catalogue chunks it also reads are the ones the manifest names. */
export const BUILT_OBJECT_INPUTS: readonly string[] = [
  DEFAULT_CATALOG_MANIFEST, DEFAULT_CONSTELLATIONS_JSON, DEFAULT_SEARCH_INDEX, DEFAULT_ROW_INDEX_MAP,
  ...SIBLING_PATHS.map((s) => s.path),
];

export interface BuiltObjects {
  objects: SidObject[];
  /** The first `starCount` objects are the catalogue's records. */
  starCount: number;
}

function requireFile(path: string, hint: string): string {
  if (!existsSync(path)) throw new Error(`missing ${path}\n  ${hint}`);
  return readFileSync(path, 'utf-8');
}

export async function builtObjects(): Promise<BuiltObjects> {
  const catalog = await loadCatalog();
  const searchIndex = JSON.parse(requireFile(DEFAULT_SEARCH_INDEX, CATALOG_HINT)) as SearchEntry[];
  const rowIndexMap = JSON.parse(requireFile(DEFAULT_ROW_INDEX_MAP, CATALOG_HINT)) as {
    bySynth: Record<string, number>;
  };

  const objects: SidObject[] = [];
  let solRecords = 0;
  for (const r of catalogRecordDesignations(catalog, searchIndex, rowIndexMap.bySynth)) {
    if (r.flags & FLAG_IS_SOL) solRecords++;
    objects.push({
      designations: r.designations,
      kind: 'star',
      label: `record ${r.i}${r.name ? ` (${r.name})` : ''}`,
    });
  }
  if (solRecords !== 1) throw new Error(`expected exactly 1 FLAG_IS_SOL record, found ${solRecords}`);
  const starCount = objects.length;

  for (const { spec, path } of SIBLING_PATHS) {
    const payload = JSON.parse(requireFile(path, `run ${spec.buildHint}`)) as Record<string, SiblingItem[]>;
    objects.push(...siblingArtifactObjects(spec, payload[spec.arrayKey]));
  }

  const solRows = SOL_OBJECTS.read();
  const sun = solRows.find((r) => r.key === 'sun');
  if (!sun || sun.kind !== 'star') throw new Error('sol-objects.tsv must carry "sun" with kind star');
  for (const row of solRows) {
    // sol:sun rides the FLAG_IS_SOL catalog record — the same-as edge of
    // /docs/sid.md#7-storage--sid-in-every-artifact — so it must not surface as a second object here.
    if (row.key === 'sun') continue;
    objects.push({ designations: [`sol:${row.key}`], kind: row.kind, label: `sol ${row.key}` });
  }

  for (const row of SHELL_OBJECTS.read()) {
    objects.push({ designations: [`shell:${row.key}`], kind: row.kind, label: `shell ${row.key}` });
  }

  return { objects, starCount };
}
