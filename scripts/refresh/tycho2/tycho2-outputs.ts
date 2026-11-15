// The two files refresh:tycho2 writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const TYCHO2_OUTPUTS = declareOutputs({ main: DATA_FILES.tycho2Main, suppl1: DATA_FILES.tycho2Suppl1 });
