// The file build:local-bubble-sync writes, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { publicRepoPath } from '../util/paths';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';

export const MIRROR_OUTPUTS = declareOutputs({ localBubble: publicRepoPath(PUBLIC_FILES.localBubble) });
