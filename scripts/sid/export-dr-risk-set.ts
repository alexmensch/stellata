// `npm run sid:risk-set` — export the DR-churn risk set: source_ids of the
// non-retired ledger rows whose canonical key is gaia_*-namespaced, as the
// request TSV a refresh:gaia-*-neighbourhood pull reads. docs/sid.md § 6.1.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { sortSourceIdsNumeric } from '../catalog/export-astrometry-request-pure';
import { REPO_ROOT as ROOT } from '../util/paths';
import { parseDesignation, parseLedgerTsv, parseRetirementsTsv } from './sid-pure';

const LEDGER_PATH = resolve(ROOT, 'data/sid/ledger.tsv');
const RETIREMENTS_PATH = resolve(ROOT, 'data/sid/retirements.tsv');
const DEFAULT_OUT = resolve(ROOT, 'data/gaia/gaia_dr2_neighbourhood_request.tsv');

function main(): void {
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const out = outArg ? resolve(outArg.slice('--out='.length)) : DEFAULT_OUT;
  if (!existsSync(LEDGER_PATH)) {
    console.error(`sid:risk-set: ${LEDGER_PATH} missing — run npm run sid:allocate first`);
    process.exit(1);
  }
  const ledger = parseLedgerTsv(readFileSync(LEDGER_PATH, 'utf-8'));
  const retired = new Set(
    parseRetirementsTsv(readFileSync(RETIREMENTS_PATH, 'utf-8')).map((r) => r.sid),
  );
  const ids = new Set<string>();
  for (const row of ledger) {
    if (retired.has(row.sid)) continue;
    const { ns, key } = parseDesignation(row.canonicalKey);
    if (ns.startsWith('gaia_')) ids.add(key);
  }
  const sorted = sortSourceIdsNumeric(ids);
  writeFileSync(out, `gaia_source_id\n${sorted.join('\n')}\n`);
  console.log(`wrote ${out} (${sorted.length} gaia_*-keyed ledger rows at risk)`);
}

main();
