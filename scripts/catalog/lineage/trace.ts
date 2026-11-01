// `pnpm run trace <name | designation | sid | gaia id> [--dir <lineage dir>]` — every stage's lineage rows for the records it names. See README.md#trace.

import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { runStep } from '../../util/emit-artifacts';
import { readArtifact } from '../../util/sources/source';
import { LEDGERS } from '../../sid/ledger-tsv';
import { EVENTS } from '../../sid/events-tsv';
import { retiredSids } from '../../sid/events-pure';
import { allocationIdentity } from '../../sid/allocation-lineage-pure';
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
  let keys: Map<number, string> | null = null;
  let retired: Map<number, { successor: number | null }> | null = null;
  return {
    canonicalKey: (sid) => (keys ??= new Map(Object.values(LEDGERS).flatMap((a) => readArtifact(a)).map((r) => [r.sid, r.canonicalKey]))).get(sid) ?? null,
    successor: (sid) => (retired ??= retiredSids(Object.values(EVENTS).flatMap((a) => readArtifact(a)))).get(sid)?.successor ?? null,
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
  const terms = queryTerms(q, lookups(catalog));
  const allocationIdentityPath = stageFile(dir, 'allocation.identity');
  const sidsOf = existsSync(allocationIdentityPath)
    ? [...allocationIdentity(gunzipSync(readFileSync(allocationIdentityPath)).toString('utf8'), allocationIdentityPath)]
    : [];
  const stages = LINEAGE_STAGES
    .filter(({ spec }) => existsSync(stageFile(dir, spec.stage)))
    .map(({ spec }) => ({ stage: spec.stage, rows: readLineage(stageFile(dir, spec.stage)) }));
  process.stdout.write(traceText(traceRecords(terms, identity, sidsOf, stages)));
}

runStep(main);
