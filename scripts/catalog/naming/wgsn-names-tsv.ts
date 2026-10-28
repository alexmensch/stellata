// Codec for data/iau-wgsn/wgsn_names.tsv. See README.md#files-in-this-area.

import { defineArtifact, nullableCell } from '../../util/tsv/artifact-pure';
import type { WgsnNameRow } from './wgsn-index-pure';

const ALIAS_SEPARATOR = '|';

export const WGSN_NAMES = defineArtifact({
  file: 'data/iau-wgsn/wgsn_names.tsv',
  columns: [
    'name', 'aliases', 'hip', 'hip_component', 'hr', 'hd', 'hd_component', 'vmag', 'source', 'src_id',
  ] as const,
  hint: 'Re-run `pnpm run build:wgsn`.',
  order: 'as-given',
  decode: (row): WgsnNameRow => {
    const aliases = row.raw('aliases');
    return {
      name: row.text('name') ?? row.fail('name is empty'),
      aliases: aliases === '' ? [] : aliases.split(ALIAS_SEPARATOR),
      hip: row.int('hip'),
      hipComponent: row.text('hip_component'),
      hr: row.int('hr'),
      hd: row.int('hd'),
      hdComponent: row.text('hd_component'),
      vmag: row.float('vmag'),
      source: row.oneOf('source', ['nec', 'faints'] as const),
      srcId: row.text('src_id') ?? row.fail('src_id is empty'),
    };
  },
  encode: (r) => ({
    name: r.name,
    aliases: r.aliases.join(ALIAS_SEPARATOR),
    hip: nullableCell(r.hip),
    hip_component: nullableCell(r.hipComponent),
    hr: nullableCell(r.hr),
    hd: nullableCell(r.hd),
    hd_component: nullableCell(r.hdComponent),
    vmag: nullableCell(r.vmag),
    source: r.source,
    src_id: r.srcId,
  }),
});
