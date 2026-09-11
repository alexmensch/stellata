// The main-pass depth pre-stamp's two decisions — how far inside the mesh
// silhouette the proxy sits, and when a body is opaque enough to stamp.
// See README.md.

/** Radial shrink of the stamp against the body mesh. The stamp must land
 *  strictly INSIDE the mesh's silhouette: anything it covers that the mesh
 *  does not paint is background culled and never repainted
 *  (README.md § What stamps, and how far inside). */
export const DEPTH_STAMP_SHRINK = 1e-3;

export function depthStampRadius(radiusPc: number): number {
  return radiusPc * (1 - DEPTH_STAMP_SHRINK);
}

/** Only a fully opaque mesh may stamp: inside the crossfade band the mesh
 *  blends with the background, which must therefore still draw. */
export function depthStampDrawn(meshFade: number): boolean {
  return meshFade >= 1;
}
