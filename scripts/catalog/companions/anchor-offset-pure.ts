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
  const pa = row.anchorPaDeg * (Math.PI / 180);
  return {
    kind: 'offset',
    east: row.anchorSepArcsec * Math.sin(pa),
    north: row.anchorSepArcsec * Math.cos(pa),
  };
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
  const sepArcsec = Math.hypot(east, north);
  if (!(sepArcsec > 0)) return null;
  const paDeg = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return { sepArcsec, paDeg };
}
