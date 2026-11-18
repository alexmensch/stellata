// How a SIMBAD ident is spelt out to compare with a name, declared. Only the citation test reads it.

import { defineSource } from '../../util/sources/source';
import { parseShortForms } from './string-designations-pure';

export const SIMBAD_SHORT_FORMS = defineSource({
  file: 'data/naming/simbad_short_forms.tsv',
  hint: 'It is hand-curated: restore the simbad_prefix, long_prefix and reason columns.',
  parse: (input) => parseShortForms(input.text(), input),
});
