// `pnpm run sid:risk-set` — export the DR-churn risk set: source_ids of the
// non-retired ledger rows whose canonical key is gaia_*-namespaced, as the
// request TSV a refresh:gaia-*-neighbourhood pull reads. /docs/sid.md#61-procedure.

import { sortSourceIdsNumeric } from '../catalog/astrometry-request/export-astrometry-request-pure';
import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { DR_RISK_SET_OUTPUTS } from './dr-risk-set-outputs';
import { LEDGER } from './ledger-tsv';
import { readRequired } from '../util/paths';
import { LEDGER_PATH, REINSTATEMENTS_PATH, RETIREMENTS_PATH } from './registry-io';
import {
  effectiveRetirements,
  parseDesignation,
  parseReinstatementsTsv,
  parseRetirementsTsv,
} from './sid-pure';

function main(): void {
  const hint = 'It is committed under data/sid/ (/docs/sid.md#43-ledger--datasidledgertsv).';
  const ledger = LEDGER.parse(readRequired(LEDGER_PATH, hint));
  const retired = effectiveRetirements(
    parseRetirementsTsv(readRequired(RETIREMENTS_PATH, hint)),
    parseReinstatementsTsv(readRequired(REINSTATEMENTS_PATH, hint)),
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