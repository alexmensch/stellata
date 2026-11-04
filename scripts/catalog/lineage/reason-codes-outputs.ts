// The file lineage:codes writes, as its emitArtifacts declaration. See README.md#reason-codes--closed-append-only-generated.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';
import { REASON_CODES_FILE } from './reason-codes-tsv';

export const REASON_CODES_OUTPUTS = declareOutputs({ codes: resolve(REPO_ROOT, REASON_CODES_FILE) });
