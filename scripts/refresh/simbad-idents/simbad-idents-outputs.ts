// The file refresh:simbad-idents writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const SIMBAD_IDENTS_OUTPUTS = declareOutputs({ idents: DATA_FILES.simbadIdents });
