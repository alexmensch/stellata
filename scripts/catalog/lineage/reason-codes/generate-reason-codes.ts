// `pnpm run lineage:codes` — regenerate data/lineage/reason-codes.tsv from every stage's declarations. See README.md.

import { emitArtifacts } from '../../../util/emit-artifacts';
import { readArtifact } from '../../../util/sources/source';
import { releaseAt } from '../../../util/release-version';
import { LINEAGE_STAGES } from '../lineage-stages';
import { reasonCodeList } from './reason-code-list-pure';
import { REASON_CODES_OUTPUTS } from './reason-codes-outputs';
import { REASON_CODES } from './reason-codes-tsv';

export function main(): void {
  const entries = reasonCodeList(LINEAGE_STAGES.map((s) => s.codes), readArtifact(REASON_CODES), releaseAt);
  emitArtifacts({ outputs: REASON_CODES_OUTPUTS, files: { codes: REASON_CODES.serialize(entries) } });
  console.log(`wrote ${entries.length} codes to ${REASON_CODES.file}`);
}

