// `pnpm run trace <name | designation | sid | gaia id> [--dir <lineage dir>]` — every stage's lineage rows for the records it names. See README.md#trace.

import { existsSync } from 'node:fs';

import { runStep } from '../../util/emit-artifacts';
import { readArtifact } from '../../util/sources/source';
import { LEDGER } from '../../sid/ledger-tsv';
import { catalogRecordDesignations } from '../../sid/catalog-designations';
import { loadCatalog, nameTable, type Catalog } from '../catalog-lookup';
import type { SearchEntry } from '../record/catalog-pure';
import { LINEAGE_LAYOUT, readIdentity, readLineage, stageFile } from './lineage-io';
import { LINEAGE_STAGES } from './lineage-stages';
import { parseTraceQuery, queryTerms, traceRecords, traceText, type TraceLookups } from './trace-pure';

const DIR_FLAG = '--dir';

interface NamedCatalog {
  readonly catalog: Catalog;
  readonly searchIndex: readonly SearchEntry[];
}

async function loadNamedCatalog(): Promise<NamedCatalog> {
  const catalog = await loadCatalog({ withSearchIndex: true });
  if (catalog.searchIndex === undefined) throw new Error('a name query needs the search index');
  return { catalog, searchIndex: catalog.searchIndex };
}

function lookups(named: NamedCatalog | null): TraceLookups {
  const need = (): NamedCatalog => {
    if (named === null) throw new Error('a name query needs the built catalogue');
    return named;
  };
  return {
    canonicalKey: (sid) => readArtifact(LEDGER).find((r) => r.sid === sid)?.canonicalKey ?? null,
    names: () => nameTable(need().catalog),
    designations: (i) => {
      const { catalog, searchIndex } = need();
      const found = catalogRecordDesignations(catalog, searchIndex, {}).find((r) => r.i === i);
      if (found === undefined) throw new Error(`record ${i} has no designation set`);
      return found.designations;
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const at = args.indexOf(DIR_FLAG);
  const dir = at >= 0 ? args[at + 1] : LINEAGE_LAYOUT.current;
  const query = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1)).join(' ');
  if (query === '' || dir === undefined) {
    throw new Error(`usage: pnpm run trace <name | designation | sid | gaia id> [${DIR_FLAG} <dir>]`);
  }
  const identityPath = stageFile(dir, 'identity');
  if (!existsSync(identityPath)) throw new Error(`no lineage at ${dir}: run \`pnpm run build:membership\``);
  const q = parseTraceQuery(query);
  const named = q.kind === 'name' ? await loadNamedCatalog() : null;
  const { designations, terms } = queryTerms(q, lookups(named));
  const stages = LINEAGE_STAGES
    .filter((s) => existsSync(stageFile(dir, s.stage)))
    .map((s) => ({ stage: s.stage, rows: readLineage(stageFile(dir, s.stage)) }));
  process.stdout.write(traceText(traceRecords(designations, terms, readIdentity(identityPath), stages)));
}

runStep(main);
