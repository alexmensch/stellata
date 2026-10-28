// Codec for data/classic-ids/classic_id_overlay.tsv. See README.md#files-in-this-area.

import { compareSourceIds } from '../../util/tsv/table-pure';
import { defineArtifact } from '../../util/tsv/artifact-pure';
import {
  OVERLAY_VALUE_SEPARATOR,
  type ClassicIdOverlay,
  type OverlayEntry,
} from './classic-id-overlay-pure';

export const OVERLAY_COLUMNS = [
  'gaia_source_id',
  'hd',
  'hr',
  'hip',
  'gj',
  'bayer',
  'flamsteed',
] as const;

export interface OverlayRow extends OverlayEntry {
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

export function overlayRows(overlay: ClassicIdOverlay): OverlayRow[] {
  return [...overlay].map(([sourceId, e]) => ({ sourceId, ...e }));
}

export function overlayMap(rows: Iterable<OverlayRow>): ClassicIdOverlay {
  const overlay: ClassicIdOverlay = new Map();
  for (const { sourceId, ...entry } of rows) overlay.set(sourceId, entry);
  return overlay;
}
