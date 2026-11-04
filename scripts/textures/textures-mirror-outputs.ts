// The files build:textures-sync writes into public/textures/, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { publicRepoPath } from '../util/paths';
import { PUBLIC_FOLDERS, TEXTURE_MEMBERS } from '../../src/catalog-format/public-artifacts/public-artifacts';

const dir = publicRepoPath(PUBLIC_FOLDERS.textures);

export const MIRROR_OUTPUTS = declareOutputs({}, Object.values(TEXTURE_MEMBERS).map((member) => ({ dir, member, stamped: true })));
