// Pure helpers for debug-panel: position clamp, hex/rgb round-trip,
// sessionStorage position parse. No DOM, no module state.

export const PANEL_WIDTH = 300;

export interface Pos { x: number; y: number; }

export function clampToViewport(
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
  panelWidth: number = PANEL_WIDTH,
): Pos {
  const margin = 8;
  const maxX = Math.max(margin, viewportW - panelWidth - margin);
  const maxY = Math.max(margin, viewportH - 80);
  return {
    x: Math.max(margin, Math.min(maxX, x)),
    y: Math.max(margin, Math.min(maxY, y)),
  };
}

/** The one `Node` capability the selection guard needs. Spelt structurally
 *  because the suite runs on `environment: 'node'` — there is no `Node` to
 *  construct a fixture from. */
export interface ContainsNode {
  contains(other: ContainsNode | null): boolean;
}

/** Whether a selection range lies inside `el` or spans across it. A live
 *  readout that rewrites `textContent` while this holds collapses the
 *  selection out from under the drag, so every per-frame write must gate on
 *  it. Both directions are load-bearing: a drag within one readout gives a
 *  range under `el`, a drag across sections gives one above it. */
export function selectionTouches(
  el: ContainsNode,
  ranges: readonly { commonAncestorContainer: ContainsNode }[],
): boolean {
  return ranges.some(
    (r) => el.contains(r.commonAncestorContainer) || r.commonAncestorContainer.contains(el),
  );
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

// Parse a sessionStorage blob into a Pos. Number.isFinite (not typeof
// 'number') so a once-saved NaN-shaped JSON gets rejected rather than
// clamping to the corner forever.
export function parsePosition(raw: string | null): Pos | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) return { x: p.x, y: p.y };
  } catch { /* corrupt JSON */ }
  return null;
}
