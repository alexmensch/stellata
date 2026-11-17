// SIMBAD's Flamsteed numbers read from the committed identifier pull and classified against IV/27A.

import type { CrossIndexRow } from '../classic-ids/classic-ids-parse';
import { classifySimbadFlamsteed, type SimbadFlamsteed } from './simbad-flamsteed-pure';
import { SIMBAD_IDENTS } from './simbad-idents-source';

export function readSimbadFlamsteed(crossIndex: readonly CrossIndexRow[]): SimbadFlamsteed {
  return classifySimbadFlamsteed(SIMBAD_IDENTS.read(), crossIndex);
}
