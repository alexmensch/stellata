// The Edenhofer 2024 (/data/papers/index.md#edenhofer2024) dust grid: the manifest and every chunk it lists, declared.

import { defineSource } from '../../../util/sources/source';
import { assembleDustGrid, parseDustManifest } from './dust-deextinction';

const DIR = 'data/dust';
const HINT = 'Re-run scripts/dust/build-dust.py.';
const chunkFile = (name: string): string => `${DIR}/${name}`;

export const DUST_GRID = defineSource({
  file: `${DIR}/manifest.json`,
  hint: HINT,
  members: (input) => parseDustManifest(input.text()).chunks.map((c) => ({ file: chunkFile(c.file), hint: HINT })),
  parse: (input) => assembleDustGrid(
    parseDustManifest(input.text()),
    (file) => input.member(chunkFile(file)).bytes(),
  ),
});
