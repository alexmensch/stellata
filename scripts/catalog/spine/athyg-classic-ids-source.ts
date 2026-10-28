// AT-HYG v3.3's classic-ID CSV, declared: the `hd` / `hyg` cells the primaries audit tallies.

import { defineSource, type Declared } from '../../util/sources/source';
import { splitCsvLine } from '../naming/wgsn-parse-pure';

function* athygHdRows(text: string, from: Declared): Generator<{ hd: string; hyg: string }> {
  const lines = text.split('\n');
  const header = splitCsvLine(lines[0]);
  const iHd = header.indexOf('hd');
  const iHyg = header.indexOf('hyg');
  if (iHd < 0 || iHyg < 0) throw new Error(`${from.file}: no hd / hyg column. ${from.hint}`);
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '') continue;
    const cells = splitCsvLine(lines[i]);
    yield { hd: cells[iHd] ?? '', hyg: cells[iHyg] ?? '' };
  }
}

export const ATHYG_CLASSIC_IDS = defineSource({
  file: 'data/athyg/athyg_33_classic_ids.csv',
  hint: 'It is frozen; restore it from git rather than regenerating it.',
  parse: (input) => athygHdRows(input.text(), input),
});
