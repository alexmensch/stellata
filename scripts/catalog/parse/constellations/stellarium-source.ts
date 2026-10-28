// Stellarium's modern sky culture: the IAU boundary edges and the stick figures, declared.

import { defineSource } from '../../../util/sources/source';
import type { StellariumSkyCulture } from './constellations';

export const STELLARIUM = defineSource({
  file: 'data/stellarium/stellarium-modern-skyculture.json',
  hint: 'It is committed: restore it from the repo (data/stellarium/README.md).',
  parse: (input) => JSON.parse(input.text()) as StellariumSkyCulture,
});
