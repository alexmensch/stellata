/** Stage 6 anchor offsets re-based onto promotion's WDS-root anchor:
 *  README.md#re-basing-a-stage-6-offset. */

import {
  polarToTangent, tangentToPolar, type PolarOffset, type TangentOffset,
} from '../../../../src/astro-core/equatorial-basis';

export interface AnchorOffsetRow {
  comp: string;
  anchorComp: string | null;
  anchorOffset: Stage6Offset;
}

export type Stage6Offset =
  | { kind: 'origin' }
  | { kind: 'offset'; offset: TangentOffset }
  | { kind: 'unreached' };

/** The multiples.tsv parse boundary for the anchor columns: the row that is
 *  Stage 6's chaining letter, a reached row, or an unreached one. */
export function parseStage6Offset(
  comp: string,
  anchorComp: string | null,
  sepArcsec: number | null,
  paDeg: number | null,
): Stage6Offset {
  const blank = sepArcsec === null && paDeg === null;
  if (anchorComp === null || comp === anchorComp) {
    if (!blank) {
      throw new Error(
        `multiples.tsv row ${comp} carries an anchor offset with no anchor to measure it from`,
      );
    }
    return anchorComp === null ? { kind: 'unreached' } : { kind: 'origin' };
  }
  if (blank) return { kind: 'unreached' };
  if (sepArcsec === null || paDeg === null) {
    throw new Error(`multiples.tsv row ${comp} carries half an anchor offset`);
  }
  return { kind: 'offset', offset: polarToTangent(sepArcsec, paDeg) };
}

export function rebasedAnchorOffset(
  row: AnchorOffsetRow,
  anchorRow: AnchorOffsetRow,
): PolarOffset | null {
  if (row.anchorComp !== anchorRow.anchorComp) {
    throw new Error(
      `anchor rows disagree on the Stage 6 anchor: ${row.comp} chains from `
      + `${row.anchorComp}, ${anchorRow.comp} from ${anchorRow.anchorComp}`,
    );
  }
  const own = row.anchorOffset;
  const anchor = anchorRow.anchorOffset;
  if (own.kind !== 'offset' || anchor.kind === 'unreached') return null;
  const base = anchor.kind === 'offset' ? anchor.offset : { eastArcsec: 0, northArcsec: 0 };
  const rebased = tangentToPolar({
    eastArcsec: own.offset.eastArcsec - base.eastArcsec,
    northArcsec: own.offset.northArcsec - base.northArcsec,
  });
  return rebased.sepArcsec > 0 ? rebased : null;
}
