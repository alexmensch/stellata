// `pnpm run lineage:codes` — regenerate data/lineage/reason-codes.tsv from every stage's declarations. See README.md#reason-codes--closed-append-only-generated.

import { resolve } from 'node:path';

import { declareOutputs, emitArtifacts, runStep } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';
import { readArtifact } from '../../util/sources/source';
import { packageVersion } from '../../util/git-provenance';
import { LINEAGE_STAGES } from './lineage-stages';
import { reasonCodeList } from './reason-code-list-pure';
import { REASON_CODES, REASON_CODES_FILE } from './reason-codes-tsv';

const OUTPUTS = declareOutputs({ codes: resolve(REPO_ROOT, REASON_CODES_FILE) });

function main(): void {
  const entries = reasonCodeList(LINEAGE_STAGES.map((s) => s.codes), readArtifact(REASON_CODES), packageVersion());
  emitArtifacts({ outputs: OUTPUTS, files: { codes: REASON_CODES.serialize(entries) } });
  console.log(`wrote ${entries.length} codes to ${REASON_CODES_FILE}`);
}

runStep(main);
