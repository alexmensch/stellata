// `pnpm run trace <name | designation | sid | gaia id> [--dir <lineage dir>]` — every stage's lineage rows for the records it names. See README.md#trace.

import { existsSync } from 'node:fs';

import { runStep } from '../../util/emit-artifacts';
import { readArtifact } from '../../util/sources/source';
import { LEDGER } from '../../sid/ledger-tsv';
import { catalogRecordDesignations } from '../../sid/catalog-designations';
import { loadCatalog, nameTable, type SearchableCatalog } from '../catalog-lookup';
import { MEMBERSHIP_LINEAGE } from '../membership/membership-lineage-pure';
import { LINEAGE_LAYOUT, readIdentity, readLineage, stageFile } from './lineage-io';
import { LINEAGE_STAGES } from './lineage-stages';
import { parseTraceQuery, queryTerms, traceRecords, traceText, type TraceLookups } from './trace-pure';

const DIR_FLAG = '--dir';

function lookups(catalog: SearchableCatalog | null): TraceLookups {
  const need = (): SearchableCatalog => {
    if (catalog === null) throw new Error('a name query needs the built catalogue');
    return catalog;
  };
  return {
    canonicalKey: (sid) => readArtifact(LEDGER).find((r) => r.sid === sid)?.canonicalKey ?? null,
    names: () => nameTable(need()),
    designations: (i) => {
      const named = need();
      const found = catalogRecordDesignations(named, named.searchIndex, {}).find((r) => r.i === i);
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
  if (!existsSync(stageFile(dir, MEMBERSHIP_LINEAGE.stage))) {
    throw new Error(`no lineage at ${dir}: run \`pnpm run build:membership\``);
  }
  const identity = LINEAGE_STAGES
    .flatMap(({ spec }) => (spec.identity === undefined ? [] : [stageFile(dir, spec.identity)]))
    .filter((path) => existsSync(path))
    .flatMap((path) => readIdentity(path));
  const q = parseTraceQuery(query);
  const catalog = q.kind === 'name' ? await loadCatalog({ withSearchIndex: true }) : null;
  const { designations, terms } = queryTerms(q, lookups(catalog));
  const stages = LINEAGE_STAGES
    .filter(({ spec }) => existsSync(stageFile(dir, spec.stage)))
    .map(({ spec }) => ({ stage: spec.stage, rows: readLineage(stageFile(dir, spec.stage)) }));
  process.stdout.write(traceText(traceRecords(designations, terms, identity, stages)));
}

runStep(main);
