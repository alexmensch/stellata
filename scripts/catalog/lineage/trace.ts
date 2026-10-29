// `pnpm run trace <name | designation | sid | gaia id> [--dir <lineage dir>]` — every stage's lineage rows for the records it names. See README.md#trace.

import { existsSync } from 'node:fs';

import { readArtifact } from '../../util/sources/source';
import { LEDGER } from '../../sid/ledger-tsv';
import { loadCatalog, lookupByName } from '../catalog-lookup';
import { LINEAGE_LAYOUT, readIdentity, readLineage, stageFile } from './lineage-io';
import { LINEAGE_STAGES } from './lineage-stages';
import { parseTraceQuery, traceRecords, traceText, type TraceQuery } from './trace-pure';

const DIR_FLAG = '--dir';

async function resolveQuery(q: TraceQuery): Promise<{ designations: string[]; terms: string[] }> {
  switch (q.kind) {
    case 'designation': return { designations: [q.designation], terms: [] };
    case 'gaia': return { designations: [`gaia_dr3:${q.sourceId}`], terms: [q.sourceId] };
    case 'sid': {
      const row = readArtifact(LEDGER).find((r) => r.sid === q.sid);
      if (row === undefined) throw new Error(`SID ${q.sid} is not in the ledger`);
      return { designations: [row.canonicalKey], terms: [] };
    }
    case 'name': {
      const record = lookupByName(await loadCatalog({ withSearchIndex: true }), q.name);
      if (record === null) throw new Error(`no catalogue record is named "${q.name}"`);
      const gaia = record.gaiaSourceId === null ? null : String(record.gaiaSourceId);
      return {
        designations: [
          ...(record.hip === null ? [] : [`hip:${record.hip}`]),
          ...(gaia === null ? [] : [`gaia_dr3:${gaia}`]),
        ],
        terms: gaia === null ? [] : [gaia],
      };
    }
    default: {
      const unhandled: never = q;
      throw new Error(`unhandled trace query ${JSON.stringify(unhandled)}`);
    }
  }
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
  const { designations, terms } = await resolveQuery(parseTraceQuery(query));
  const stages = LINEAGE_STAGES
    .filter((s) => existsSync(stageFile(dir, s.stage)))
    .map((s) => ({ stage: s.stage, rows: readLineage(stageFile(dir, s.stage)) }));
  process.stdout.write(traceText(traceRecords(designations, terms, readIdentity(identityPath), stages)));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
