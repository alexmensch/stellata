// The main-pass depth pre-stamp's two decisions — how far inside the mesh
// silhouette the proxy sits, and when a body is opaque enough to stamp.
// See README.md.

/** Radial shrink of the stamp against the body mesh. Perspective x/y are
 *  independent of near/far, so the main-pass stamp and the local-pass mesh
 *  project the same geometry to the same pixels; this margin covers float
 *  differences between the two draws and nothing else. */
export const DEPTH_STAMP_SHRINK = 1e-3;

/** Draw order shared with the star core mask: first in the frame, so every
 *  background layer after it depth-fails inside the silhouette
 *  (`../../../README.md` § Full render stack — front to back). */
export const DEPTH_STAMP_RENDER_ORDER = -4;

export function depthStampRadius(radiusPc: number): number {
  return radiusPc * (1 - DEPTH_STAMP_SHRINK);
}

/** Only a fully opaque mesh may stamp: inside the crossfade band the mesh
 *  blends with the background, which must therefore still draw. */
export function depthStampDrawn(meshFade: number): boolean {
  return meshFade >= 1;
}
