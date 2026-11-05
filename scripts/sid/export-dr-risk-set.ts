// `pnpm run sid:risk-set` — export the DR-churn risk set: source_ids of the
// non-retired ledger rows whose canonical key is gaia_*-namespaced, as the
// request TSV a refresh:gaia-*-neighbourhood pull reads. /docs/sid.md#61-procedure.

import { serialiseSourceIdRequest } from '../catalog/astrometry-request/export-astrometry-request-pure';
import { emitArtifacts } from '../util/emit-artifacts';
import { DR_RISK_SET_OUTPUTS } from './dr-risk-set-outputs';
import { LEDGERS } from './ledger-tsv';
import { readArtifact } from '../util/sources/source';
import { retiredSids } from './events-pure';
import { EVENTS } from './events-tsv';
import { parseDesignation } from './sid-pure';
import { CATALOG_PARTITION } from '../../src/catalog-format/pipeline-outputs/data-files';

export function main(): void {
  const ledger = readArtifact(LEDGERS[CATALOG_PARTITION]);
  const retired = retiredSids(readArtifact(EVENTS[CATALOG_PARTITION]));
  const ids = new Set<string>();
  for (const row of ledger) {
    if (retired.has(row.sid)) continue;
    const { ns, key } = parseDesignation(row.canonicalKey);
    if (ns.startsWith('gaia_')) ids.add(key);
  }
  emitArtifacts({
    outputs: DR_RISK_SET_OUTPUTS,
    files: { request: serialiseSourceIdRequest(ids) },
  });
  console.log(`wrote ${DR_RISK_SET_OUTPUTS.files.request} (${ids.size} gaia_*-keyed ledger rows at risk)`);
}
