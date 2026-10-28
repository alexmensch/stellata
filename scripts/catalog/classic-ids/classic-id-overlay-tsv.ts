// Codec for data/classic-ids/classic_id_overlay.tsv. See README.md#files-in-this-area.

import { compareSourceIds } from '../../util/tsv/table-pure';
import { defineArtifact } from '../../util/tsv/artifact-pure';

/** No cell is single-valued by construction: a designation naming a
 *  catalogue granularity rather than one object attaches to every matching
 *  record, and a record can carry several. */
export const OVERLAY_VALUE_SEPARATOR = '|';

export const OVERLAY_COLUMNS = [
  'gaia_source_id',
  'hd',
  'hr',
  'hip',
  'gj',
  'bayer',
  'flamsteed',
] as const;

/** Every classic designation the frozen joins attach to one Gaia DR3
 *  source. `gj` is a bare CNS5 number with its component letter appended
 *  ("551C"); `bayer` / `flamsteed` carry IV/27A's constellation
 *  ("alf Lyr", "3 Lyr"). Each list is sorted and deduplicated. */
export interface OverlayEntry {
  hd: number[];
  hr: number[];
  hip: number[];
  gj: string[];
  bayer: string[];
  flamsteed: string[];
}

export type ClassicIdOverlay = Map<string, OverlayEntry>;

interface OverlayRow extends OverlayEntry {
  sourceId: string;
}

export const CLASSIC_ID_OVERLAY = defineArtifact({
  file: 'data/classic-ids/classic_id_overlay.tsv',
  columns: OVERLAY_COLUMNS,
  hint: 'Re-run `pnpm run build:classic-ids`.',
  order: (a: OverlayRow, b: OverlayRow) => compareSourceIds(a.sourceId, b.sourceId),
  decode: (row): OverlayRow => {
    const list = (c: (typeof OVERLAY_COLUMNS)[number]): string[] =>
      (row.raw(c) === '' ? [] : row.raw(c).split(OVERLAY_VALUE_SEPARATOR));
    return {
      sourceId: row.requiredSourceId('gaia_source_id'),
      hd: row.idList('hd', OVERLAY_VALUE_SEPARATOR),
      hr: row.idList('hr', OVERLAY_VALUE_SEPARATOR),
      hip: row.idList('hip', OVERLAY_VALUE_SEPARATOR),
      gj: list('gj'),
      bayer: list('bayer'),
      flamsteed: list('flamsteed'),
    };
  },
  encode: (r) => ({
    gaia_source_id: r.sourceId,
    hd: r.hd.join(OVERLAY_VALUE_SEPARATOR),
    hr: r.hr.join(OVERLAY_VALUE_SEPARATOR),
    hip: r.hip.join(OVERLAY_VALUE_SEPARATOR),
    gj: r.gj.join(OVERLAY_VALUE_SEPARATOR),
    bayer: r.bayer.join(OVERLAY_VALUE_SEPARATOR),
    flamsteed: r.flamsteed.join(OVERLAY_VALUE_SEPARATOR),
  }),
});

export function serializeOverlay(overlay: ClassicIdOverlay): string {
  return CLASSIC_ID_OVERLAY.serialize([...overlay].map(([sourceId, e]) => ({ sourceId, ...e })));
}

export function parseOverlayTsv(text: string): ClassicIdOverlay {
  const overlay: ClassicIdOverlay = new Map();
  for (const { sourceId, ...entry } of CLASSIC_ID_OVERLAY.rows(text)) overlay.set(sourceId, entry);
  return overlay;
}
