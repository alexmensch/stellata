// Codec for data/iau-wgsn/wgsn_designations.tsv. See README.md#files-in-this-area.

import { defineArtifact, nullableCell } from '../../util/tsv/artifact-pure';
import {
  DESIGNATION_KINDS, DESIGNATION_SOURCES, compareDesignationRows, type DesignationRow,
} from './wgsn-tables-pure';

export const WGSN_DESIGNATIONS = defineArtifact({
  file: 'data/iau-wgsn/wgsn_designations.tsv',
  columns: [
    'kind', 'letter', 'sup', 'num', 'dc', 'half', 'component', 'hip', 'hr', 'hd', 'source',
  ] as const,
  hint: 'Re-run `pnpm run build:wgsn`.',
  order: compareDesignationRows,
  decode: (row): DesignationRow => ({
    kind: row.oneOf('kind', DESIGNATION_KINDS),
    letter: row.text('letter'),
    sup: row.int('sup'),
    num: row.int('num'),
    dc: row.raw('dc'),
    half: row.text('half'),
    component: row.text('component'),
    hip: row.int('hip'),
    hr: row.int('hr'),
    hd: row.int('hd'),
    source: row.oneOf('source', DESIGNATION_SOURCES),
  }),
  encode: (d) => ({
    kind: d.kind,
    letter: nullableCell(d.letter),
    sup: nullableCell(d.sup),
    num: nullableCell(d.num),
    dc: d.dc,
    half: nullableCell(d.half),
    component: nullableCell(d.component),
    hip: nullableCell(d.hip),
    hr: nullableCell(d.hr),
    hd: nullableCell(d.hd),
    source: d.source,
  }),
});
