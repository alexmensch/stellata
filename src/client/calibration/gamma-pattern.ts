// Draws one gamma match cell: a solid patch inside a 50/50 black-white
// line pattern, which averages to 0.5 linear luminance.
// See src/client/calibration/README.md § Gamma.

import { greyCss } from './calibration-ladders-pure';

const PATCH_FRACTION = 0.5;

/** Sizes the backing store from the canvas's laid-out CSS box, so the cell
 *  tracks the responsive sizing in the stylesheet. Requires layout — a
 *  still-hidden canvas measures zero and is skipped. */
export function drawGammaCell(
  canvas: HTMLCanvasElement,
  code: number,
  dpr: number,
): void {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const w = Math.max(2, Math.round(rect.width * dpr));
  const h = Math.max(2, Math.round(rect.height * dpr));
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  // One device pixel per stripe. A CSS-pixel pattern halves the frequency
  // on a 2× display, which lets the eye resolve the stripes instead of
  // integrating them — the average stops being 0.5 and every match point
  // shifts. Backing store scaled by dpr is what keeps this exact.
  for (let y = 0; y < h; y++) {
    ctx.fillStyle = y % 2 === 0 ? '#ffffff' : '#000000';
    ctx.fillRect(0, y, w, 1);
  }

  const pw = Math.round(w * PATCH_FRACTION);
  const ph = Math.round(h * PATCH_FRACTION);
  ctx.fillStyle = greyCss(code);
  ctx.fillRect(Math.round((w - pw) / 2), Math.round((h - ph) / 2), pw, ph);
}
