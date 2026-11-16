// multiples.tsv's row key, for the codec and for readers that cite a row without opening the file. See README.md#files-in-this-area.

import { rowKeyText, type RowKey } from '../util/sources/row-ref-pure';

export const MULTIPLES_ROW_KEY: RowKey<{ readonly systemId: string; readonly comp: string }> = {
  id: 'multiples',
  cardinality: 'one',
  text: ({ systemId, comp }) => `${systemId}/${comp}`,
};

export function pairSystemId(pair: { readonly wdsId: string; readonly components: string }): string {
  return `${pair.wdsId}-${pair.components}`;
}

/** The text of the row `multiples.tsv` writes for one component of one pair row. */
export function componentRowKey(pair: { readonly wdsId: string; readonly components: string }, component: string): string {
  return rowKeyText(MULTIPLES_ROW_KEY, { systemId: pairSystemId(pair), comp: component });
}
