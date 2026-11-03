// multiples.tsv's row key, for the codec and for readers that cite a row without opening the file. See README.md#files-in-this-area.

import type { RowKey } from '../util/sources/row-ref-pure';

export const MULTIPLES_ROW_KEY: RowKey<{ readonly systemId: string; readonly comp: string }> = {
  id: 'multiples',
  text: ({ systemId, comp }) => `${systemId}/${comp}`,
};
