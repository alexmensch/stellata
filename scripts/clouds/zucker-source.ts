// build:clouds' four Zucker tables, declared.

import { defineSource } from '../util/sources/source';
import { parseZ2020Sightlines, parseZ2021Extents, parseZ2021Masses, parseZ2021PlummerFits } from './zucker-parse';

const HINT = 'It is a committed VizieR table; see data/molecular-clouds/README.md.';

export const ZUCKER_2020 = defineSource({
  file: 'data/molecular-clouds/zucker2020-tablea1.tsv',
  hint: HINT,
  parse: (input) => parseZ2020Sightlines(input.text()),
});

export const ZUCKER_2021_EXTENTS = defineSource({
  file: 'data/molecular-clouds/zucker2021-table1.dat',
  hint: HINT,
  parse: (input) => parseZ2021Extents(input.text(), input),
});

export const ZUCKER_2021_FITS = defineSource({
  file: 'data/molecular-clouds/zucker2021-table2.dat',
  hint: HINT,
  parse: (input) => parseZ2021PlummerFits(input.text(), input),
});

export const ZUCKER_2021_MASSES = defineSource({
  file: 'data/molecular-clouds/zucker2021-table3.dat',
  hint: HINT,
  parse: (input) => parseZ2021Masses(input.text(), input),
});
