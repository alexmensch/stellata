/** Stage 6 anchor offsets re-based onto promotion's WDS-root anchor:
 *  README.md#promoted-companion-field-inheritance. */

export interface AnchorOffsetRow {
  comp: string;
  anchorComp: string | null;
  anchorOffset: Stage6Offset;
}

export interface SepPa {
  sepArcsec: number;
  paDeg: number;
}

export interface TangentOffset {
  east: number;
  north: number;
}

export function tangentOffset(sepArcsec: number, paDeg: number): TangentOffset {
  const pa = paDeg * (Math.PI / 180);
  return { east: sepArcsec * Math.sin(pa), north: sepArcsec * Math.cos(pa) };
}

export function sepPaOf({ east, north }: TangentOffset): SepPa {
  return {
    sepArcsec: Math.hypot(east, north),
    paDeg: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
  };
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
  return { kind: 'offset', offset: tangentOffset(sepArcsec, paDeg) };
}

export function rebasedAnchorOffset(
  row: AnchorOffsetRow,
  anchorRow: AnchorOffsetRow,
): SepPa | null {
  if (row.anchorComp !== anchorRow.anchorComp) {
    throw new Error(
      `anchor rows disagree on the Stage 6 anchor: ${row.comp} chains from `
      + `${row.anchorComp}, ${anchorRow.comp} from ${anchorRow.anchorComp}`,
    );
  }
  const own = row.anchorOffset;
  const anchor = anchorRow.anchorOffset;
  if (own.kind !== 'offset' || anchor.kind === 'unreached') return null;
  const base = anchor.kind === 'offset' ? anchor.offset : { east: 0, north: 0 };
  const east = own.offset.east - base.east;
  const north = own.offset.north - base.north;
  const rebased = sepPaOf({ east, north });
  return rebased.sepArcsec > 0 ? rebased : null;
}
