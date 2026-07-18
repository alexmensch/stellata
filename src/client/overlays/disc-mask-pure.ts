// Pure index-selection contract for the disc-mask SVG cutout pass.
// See src/client/overlays/README.md § Constellation stick-figure overlay.

export interface ConstellationLike {
  lines?: ReadonlyArray<ReadonlyArray<number>>;
}

// Return the ordered, deduplicated list of star indices the mask pass
// should consider this frame. Threshold filtering and projection happen
// in the caller — this helper only knows the iteration contract:
//
//   focused star, then its companion, then every vertex of the
//   highlighted constellation, with each index emitted at most once.
//
// `focus` may be null when no star is focused. `companion` is the
// companion of the focused star (or -1 when none, matching the
// `catalog.companion` sentinel). `highlightCon` is -1 when no
// constellation is highlighted, or an out-of-range value if the
// caller hasn't validated it.
export function selectMaskCandidates(
  focus: number | null,
  companion: number,
  highlightCon: number,
  constellations: ReadonlyArray<ConstellationLike>,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (idx: number) => {
    if (idx < 0 || seen.has(idx)) return;
    seen.add(idx);
    out.push(idx);
  };

  if (focus !== null) {
    add(focus);
    add(companion);
  }

  if (highlightCon >= 0 && highlightCon < constellations.length) {
    const lines = constellations[highlightCon].lines;
    if (lines) {
      for (const polyline of lines) {
        for (const i of polyline) add(i);
      }
    }
  }

  return out;
}

// Flat planet-instance indices the mask pass should cut out this frame:
// every live instance except the observe-anchor body hidden via uHideIdx
// (that body writes no colour, so a cutout for it would carve a spurious
// gap in the figure). Size/projection filtering happens in the caller,
// mirroring the star candidate path.
export function selectPlanetMaskCandidates(
  liveInstanceCount: number,
  hiddenInstanceIdx: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < liveInstanceCount; i++) {
    if (i === hiddenInstanceIdx) continue;
    out.push(i);
  }
  return out;
}
