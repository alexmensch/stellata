/** Stage 6 anchor offsets re-based onto promotion's WDS-root anchor:
 *  README.md#promoted-companion-field-inheritance. */

export interface AnchorOffsetRow {
  comp: string;
  anchorComp: string | null;
  anchorSepArcsec: number | null;
  anchorPaDeg: number | null;
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

type Stage6Offset =
  | { kind: 'origin' }
  | { kind: 'offset'; east: number; north: number }
  | { kind: 'unreached' };

function stage6Offset(row: AnchorOffsetRow): Stage6Offset {
  if (row.anchorComp === null) return { kind: 'unreached' };
  if (row.comp === row.anchorComp) return { kind: 'origin' };
  if (row.anchorSepArcsec === null || row.anchorPaDeg === null) {
    return { kind: 'unreached' };
  }
  return { kind: 'offset', ...tangentOffset(row.anchorSepArcsec, row.anchorPaDeg) };
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
  const own = stage6Offset(row);
  const anchor = stage6Offset(anchorRow);
  if (own.kind !== 'offset' || anchor.kind === 'unreached') return null;
  const east = own.east - (anchor.kind === 'offset' ? anchor.east : 0);
  const north = own.north - (anchor.kind === 'offset' ? anchor.north : 0);
  const rebased = sepPaOf({ east, north });
  return rebased.sepArcsec > 0 ? rebased : null;
}
