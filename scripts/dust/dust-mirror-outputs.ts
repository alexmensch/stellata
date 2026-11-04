// The files build:dust-sync writes into public/dust/, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { publicRepoPath } from '../util/paths';
import { DUST_CHUNK, DUST_MANIFEST, PUBLIC_FOLDERS } from '../../src/catalog-format/public-artifacts/public-artifacts';

const dir = publicRepoPath(PUBLIC_FOLDERS.dust);

export const MIRROR_OUTPUTS = declareOutputs({ manifest: `${dir}/${DUST_MANIFEST}` }, [{ dir, member: DUST_CHUNK, stamped: true }]);
