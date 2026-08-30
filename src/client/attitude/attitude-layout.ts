// Where the instrument's parts sit: the mini-renderer's view geometry, the
// sphere's silhouette that follows from it, and the design box the SVG chrome
// is drawn in. README.md § Rendering, § Case chrome.

/** The mini-renderer's view: a unit sphere at `BALL_VIEW_DIST` under a
 *  vertical `BALL_VIEW_FOV_DEG`. `BALL_R` is a consequence of the pair, so
 *  `attitude-ball.ts` builds its camera from these rather than restating the
 *  numbers the silhouette was solved from. */
export const BALL_VIEW_DIST = 6;
export const BALL_VIEW_FOV_DEG = 20;

/** The SVG's design space. Chrome is drawn in these units and CSS scales the
 *  whole instrument to `RENDERED_BOX_PX`, so resizing is one number in the
 *  stylesheet rather than a re-measured drawing. */
export const BOX = 192;
export const BALL_PX = 160;
export const C = BOX / 2;

/** The sphere's silhouette in the mini-renderer: half-angle asin(1/dist)
 *  against the half-FOV, scaled to the canvas. Every ring is placed off it. */
export const BALL_R = (BALL_PX / 2)
  * (Math.tan(Math.asin(1 / BALL_VIEW_DIST))
    / Math.tan((BALL_VIEW_FOV_DEG / 2) * (Math.PI / 180)));

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

/** The ball's raster size in CSS pixels. `attitude-ball.ts` sizes its drawing
 *  buffer off this; the stylesheet sizes the element to match. */
export const BALL_RASTER_PX = BALL_PX * RENDERED_SCALE;

/** `CHROME_INSET` on the page. The scale bar under the instrument pads its
 *  left endcap by this so the two share a left edge — `../ui/scale-bar.ts`. */
export const CHROME_INSET_PX = CHROME_INSET * RENDERED_SCALE;
