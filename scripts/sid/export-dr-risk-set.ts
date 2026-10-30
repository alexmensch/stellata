// `pnpm run sid:risk-set` — export the DR-churn risk set: source_ids of the
// non-retired ledger rows whose canonical key is gaia_*-namespaced, as the
// request TSV a refresh:gaia-*-neighbourhood pull reads. /docs/sid.md#61-procedure.

import { sortSourceIdsNumeric } from '../catalog/astrometry-request/export-astrometry-request-pure';
import { emitArtifacts, runStep } from '../util/emit-artifacts';
import { DR_RISK_SET_OUTPUTS } from './dr-risk-set-outputs';
import { LEDGER } from './ledger-tsv';
import { readArtifact } from '../util/sources/source';
import { retiredSids } from './events-pure';
import { EVENTS } from './events-tsv';
import { parseDesignation } from './sid-pure';

function main(): void {
  const ledger = readArtifact(LEDGER);
  const retired = retiredSids(readArtifact(EVENTS));
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