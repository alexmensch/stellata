import { describe, it, expect } from 'vitest';
import {
  BALL_PX,
  BALL_R,
  BALL_RASTER_PX,
  BALL_VIEW_DIST,
  BALL_VIEW_FOV_DEG,
  BANK_TICK_MAX_LEN,
  BEZEL_GAP,
  BOX,
  C,
  CHROME_INSET,
  CHROME_INSET_PX,
  CHROME_R,
  RENDERED_BOX_PX,
} from './attitude-layout';

describe('attitude layout', () => {
  it('solves the silhouette from the mini-renderer\'s own view', () => {
    // Independent re-derivation: the sphere is unit-radius, so its half-angle
    // is asin(1/dist), and the canvas maps the half-FOV to half its width.
    const halfAngle = Math.asin(1 / BALL_VIEW_DIST);
    const halfFov = (BALL_VIEW_FOV_DEG / 2) * (Math.PI / 180);
    const expected = (BALL_PX / 2) * (Math.tan(halfAngle) / Math.tan(halfFov));
    expect(BALL_R).toBeCloseTo(expected, 12);
    expect(BALL_R).toBeCloseTo(76.6897, 4);
  });

  it('keeps the outermost chrome inside the design box', () => {
    expect(CHROME_R).toBeCloseTo(BALL_R + BEZEL_GAP + BANK_TICK_MAX_LEN, 12);
    expect(CHROME_R).toBeCloseTo(91.1897, 4);
    expect(CHROME_INSET).toBeCloseTo(C - CHROME_R, 12);
    expect(CHROME_INSET).toBeCloseTo(4.8103, 4);
  });

  it('scales the design space to the rendered box without distorting it', () => {
    // The SVG chrome is drawn in design units and CSS stretches it to the
    // rendered box, while the ball's canvas is sized in CSS pixels. The two
    // only stay concentric while this ratio holds — a bezel that no longer
    // hugs the ball is what breaking it looks like.
    expect(BALL_RASTER_PX / RENDERED_BOX_PX).toBeCloseTo(BALL_PX / BOX, 12);
    expect(RENDERED_BOX_PX).toBe(192);
    expect(BALL_RASTER_PX).toBe(160);
  });

  it('reports the optical inset the scale bar aligns to', () => {
    expect(CHROME_INSET_PX).toBeCloseTo(CHROME_INSET * (RENDERED_BOX_PX / BOX), 12);
    expect(CHROME_INSET_PX).toBeCloseTo(4.8103, 4);
  });
});
