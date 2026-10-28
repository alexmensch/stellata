// `pnpm run sid:risk-set` — export the DR-churn risk set: source_ids of the
// non-retired ledger rows whose canonical key is gaia_*-namespaced, as the
// request TSV a refresh:gaia-*-neighbourhood pull reads. /docs/sid.md#61-procedure.

import { existsSync, readFileSync } from 'node:fs';

import { sortSourceIdsNumeric } from '../catalog/astrometry-request/export-astrometry-request-pure';
import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { DR_RISK_SET_OUTPUTS } from './dr-risk-set-outputs';
import { LEDGER_PATH, REINSTATEMENTS_PATH, RETIREMENTS_PATH } from './registry-io';
import {
  REINSTATEMENTS_HEADER,
  effectiveRetirements,
  parseDesignation,
  parseLedgerTsv,
  parseReinstatementsTsv,
  parseRetirementsTsv,
} from './sid-pure';

function main(): void {
  if (!existsSync(LEDGER_PATH)) {
    console.error(`sid:risk-set: ${LEDGER_PATH} missing — run pnpm run sid:allocate first`);
    process.exit(1);
  }
  const ledger = parseLedgerTsv(readFileSync(LEDGER_PATH, 'utf-8'));
  const reinstatementsText = existsSync(REINSTATEMENTS_PATH)
    ? readFileSync(REINSTATEMENTS_PATH, 'utf-8')
    : `${REINSTATEMENTS_HEADER}\n`;
  const retired = effectiveRetirements(
    parseRetirementsTsv(readFileSync(RETIREMENTS_PATH, 'utf-8')),
    parseReinstatementsTsv(reinstatementsText),
  );
  const ids = new Set<string>();
  for (const row of ledger) {
    if (retired.has(row.sid)) continue;
    const { ns, key } = parseDesignation(row.canonicalKey);
    if (ns.startsWith('gaia_')) ids.add(key);
  }
  const sorted = sortSourceIdsNumeric(ids);
  emitArtifacts({
    outputs: DR_RISK_SET_OUTPUTS,
    files: { request: `gaia_source_id\n${sorted.join('\n')}\n` },
  });
  console.log(`wrote ${DR_RISK_SET_OUTPUTS.files.request} (${sorted.length} gaia_*-keyed ledger rows at risk)`);
}

runStep(main);