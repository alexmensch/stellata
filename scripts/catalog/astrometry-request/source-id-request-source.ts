// A source_id request file declared as a source, read through the request format's one parse.

import { defineSource, type Declared } from '../../util/sources/source';
import { readSourceIdRequest } from './export-astrometry-request-pure';

export function sourceIdRequestSource(declared: Declared) {
  return defineSource({ ...declared, parse: (input) => readSourceIdRequest(input.text(), input) });
}
