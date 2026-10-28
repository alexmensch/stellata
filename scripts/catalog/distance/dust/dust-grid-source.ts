// The Edenhofer 2024 (/data/papers/index.md#edenhofer2024) dust grid: the manifest and every chunk it lists, declared.

import { defineSource, openDeclared } from '../../../util/sources/source';
import { assembleDustGrid, parseDustManifest } from './dust-deextinction';

const DIR = 'data/dust';
const HINT = 'Re-run scripts/dust/build-dust.py.';

export const DUST_GRID = defineSource({
  file: `${DIR}/manifest.json`,
  hint: HINT,
  members: (input) => parseDustManifest(input.text()).chunks.map((c) => ({ file: `${DIR}/${c.file}`, hint: HINT })),
  parse: (input) => assembleDustGrid(
    parseDustManifest(input.text()),
    (file) => openDeclared({ file: `${DIR}/${file}`, hint: HINT }).bytes(),
  ),
});
