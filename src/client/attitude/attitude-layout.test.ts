import { describe, it, expect } from 'vitest';
import {
  BALL_PX,
  BALL_R,
  BALL_RASTER_PX,
  BALL_SILHOUETTE_DEG,
  BALL_VIEW_DIST,
  BALL_VIEW_FOV_DEG,
  BALL_VISIBLE_CAP_DEG,
  BANK_TICK_MAX_LEN,
  BEZEL_GAP,
  BOX,
  C,
  CHROME_INSET,
  CHROME_R,
  RENDERED_BOX_PX,
} from './attitude-layout';

describe('attitude layout', () => {
  it('reads the ball through an aperture, not around its silhouette', () => {
    expect(BALL_R).toBe(BALL_PX / 2);
    // The window must sit strictly inside the sphere's own half-angle, or its
    // rim shows background instead of ball and the disc stops reading as a
    // window onto something larger.
    expect(BALL_VIEW_FOV_DEG / 2).toBeLessThan(BALL_SILHOUETTE_DEG);
    expect(BALL_SILHOUETTE_DEG).toBeCloseTo(9.5941, 4);
  });

  it('shows the ±30° square and a little more', () => {
    // Independent re-derivation of the cap: a ray at the half-FOV, from a
    // camera BALL_VIEW_DIST out, meets the unit sphere this far from the
    // sub-viewer point.
    const halfFov = (BALL_VIEW_FOV_DEG / 2) * (Math.PI / 180);
    const sin = Math.sin(halfFov);
    const cos = Math.cos(halfFov);
    const hit = BALL_VIEW_DIST * sin * sin
      + cos * Math.sqrt(1 - BALL_VIEW_DIST * BALL_VIEW_DIST * sin * sin);
    expect(BALL_VISIBLE_CAP_DEG).toBeCloseTo(Math.acos(hit) * (180 / Math.PI), 12);
    expect(BALL_VISIBLE_CAP_DEG).toBeCloseTo(44.0506, 4);

    // The graticule's solid lines run every 30°, and the corner of the ±30°
    // square is what has to stay inside the window — that square is the whole
    // brief. A margin of ~2.6° is the "a little more"; much more and the
    // instrument stops reading like the real one.
    const squareCornerDeg = Math.acos(Math.cos(30 * (Math.PI / 180)) ** 2)
      * (180 / Math.PI);
    expect(squareCornerDeg).toBeCloseTo(41.4096, 4);
    expect(BALL_VISIBLE_CAP_DEG).toBeGreaterThan(squareCornerDeg);
    expect(BALL_VISIBLE_CAP_DEG - squareCornerDeg).toBeLessThan(5);
  });

  it('keeps the outermost chrome inside the design box', () => {
    expect(CHROME_R).toBeCloseTo(BALL_R + BEZEL_GAP + BANK_TICK_MAX_LEN, 12);
    expect(CHROME_R).toBeCloseTo(94.5, 4);
    expect(CHROME_INSET).toBeCloseTo(C - CHROME_R, 12);
    expect(CHROME_INSET).toBeCloseTo(1.5, 4);
  });

  it('scales the design space to the rendered box without distorting it', () => {
    // The SVG chrome is drawn in design units and CSS stretches it to the
    // rendered box, while the ball's canvas is sized in CSS pixels. The two
    // only stay concentric while this ratio holds — a bezel that no longer
    // hugs the ball is what breaking it looks like.
    expect(BALL_RASTER_PX / RENDERED_BOX_PX).toBeCloseTo(BALL_PX / BOX, 12);
    expect(RENDERED_BOX_PX).toBe(240);
    expect(BALL_RASTER_PX).toBe(200);
  });

});
