// Where the instrument's parts sit: the mini-renderer's view geometry, the
// sphere's silhouette that follows from it, and the design box the SVG chrome
// is drawn in. README.md § Rendering, § Case chrome.

/** The mini-renderer's view: a unit sphere at `BALL_VIEW_DIST` under a
 *  vertical `BALL_VIEW_FOV_DEG`. `attitude-ball.ts` builds its camera from
 *  these rather than restating them. */
export const BALL_VIEW_DIST = 6;
export const BALL_VIEW_FOV_DEG = 15;

/** The SVG's design space. Chrome is drawn in these units and CSS scales the
 *  whole instrument to `RENDERED_BOX_PX`, so resizing is one number in the
 *  stylesheet rather than a re-measured drawing. */
export const BOX = 192;
export const BALL_PX = 160;
export const C = BOX / 2;

/** The window the ball is read through, and the circle every ring is placed
 *  off. The FOV above is narrow enough that the sphere **overflows** it, so
 *  this is an aperture rather than a silhouette: the disc is ball edge to
 *  edge, and what falls outside is simply not shown. That is the real
 *  instrument's arrangement — a large ball behind a small window — and
 *  § The window, not the whole ball says why it is not a wider view. */
export const BALL_R = BALL_PX / 2;

/** How much of the sphere's surface the window shows, as an angle from the
 *  boresight at the disc's rim. Derived from the view alone: a ray at the
 *  half-FOV meets the sphere at this angle from the sub-viewer point. The
 *  graticule's solid lines run every 30°, so this has to clear the ±30° / ±30°
 *  square's own corner at 41.4° — with a little to spare, and no more. */
export const BALL_VISIBLE_CAP_DEG = visibleCapDeg(BALL_VIEW_DIST, BALL_VIEW_FOV_DEG);

function visibleCapDeg(dist: number, fovDeg: number): number {
  const halfFov = (fovDeg / 2) * (Math.PI / 180);
  const sin = Math.sin(halfFov);
  const cos = Math.cos(halfFov);
  const chord = Math.sqrt(1 - dist * dist * sin * sin);
  return Math.acos(dist * sin * sin + cos * chord) * (180 / Math.PI);
}

/** Half-angle of the sphere itself. The aperture must stay inside it, or the
 *  window's rim would show background rather than ball. */
export const BALL_SILHOUETTE_DEG = Math.asin(1 / BALL_VIEW_DIST) * (180 / Math.PI);

export const BEZEL_GAP = 2.5;
/** The 90° bank ticks, which are the outermost ink on the instrument. */
export const BANK_TICK_MAX_LEN = 12;
export const CHROME_R = BALL_R + BEZEL_GAP + BANK_TICK_MAX_LEN;

/** Design units between the box's edge and that outermost ink. The box is
 *  square around a round instrument, so its edge is not what the eye reads as
 *  the instrument's edge — anything aligning to the instrument aligns here. */
export const CHROME_INSET = C - CHROME_R;

/** What the instrument measures on the page. The design space above scales to
 *  this, so strokes, ticks and the caret grow with the ball. */
export const RENDERED_BOX_PX = 240;
const RENDERED_SCALE = RENDERED_BOX_PX / BOX;

/** The ball's drawing-buffer size in CSS pixels — a resolution, not a layout
 *  size: the element itself fills its panel column, and `RENDERED_BOX_PX` is
 *  the width that resolution was chosen against. */
export const BALL_RASTER_PX = BALL_PX * RENDERED_SCALE;
