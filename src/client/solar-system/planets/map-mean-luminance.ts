// Sphere-weighted mean linear luminance of an equirectangular day map —
// the normaliser that reduces a brightness-stretched mosaic to a pure
// albedo pattern. See README.md § Physical-luminance emission.

import { relativeLuminance, srgbDecode } from '../../hdr/tonemap-pure';

/** Rows of the downscaled copy the mean is measured on. Small because the
 *  mean converges long before detail does, and this runs on the main
 *  thread the frame a map finishes loading. */
export const MEAN_SAMPLE_ROWS = 64;

/**
 * Mean linear luminance of equirect RGBA bytes, rows weighted by
 * cos(latitude) so the map's compressed polar rows don't outvote the
 * equator — the same sphere weighting the build-time colour calibration
 * uses (`data/textures/README.md` § Colour fidelity).
 *
 * Bytes are sRGB-encoded (the maps load `NoColorSpace` and the mesh shader
 * decodes them), so each channel is decoded before weighting: the mean of
 * the decoded values is what the shader divides by, and decoding after
 * averaging would give a different — and wrong — number.
 */
export function equirectMeanLinearLuminance(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let weighted = 0;
  let weightSum = 0;
  for (let row = 0; row < height; row++) {
    const lat = Math.PI * (0.5 - (row + 0.5) / height);
    const weight = Math.cos(lat);
    if (weight <= 0) continue;
    let rowSum = 0;
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4;
      rowSum += relativeLuminance([
        srgbDecode(rgba[i] / 255),
        srgbDecode(rgba[i + 1] / 255),
        srgbDecode(rgba[i + 2] / 255),
      ]);
    }
    weighted += (rowSum / width) * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? weighted / weightSum : 0;
}

/**
 * Measure a loaded day map, or return `null` when the browser won't give
 * back pixels (no 2D context). A null result keeps the body on its
 * representative colour's luminance, which is the same normaliser the
 * texture-less path uses — dimmer or brighter than exact, never unscaled.
 */
export function measureMapMeanLuminance(image: TexImageSource): number | null {
  const height = MEAN_SAMPLE_ROWS;
  const width = height * 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return null;
  ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
  return equirectMeanLinearLuminance(
    ctx.getImageData(0, 0, width, height).data,
    width,
    height,
  );
}
