// Pure helpers mirroring the GLSL math in `star.vert.glsl`'s chart-mode
// branch. See src/client/chart-mode/README.md § Star disc sizing.

export interface ChartDiscParams {
  maxPx: number;
  minPx: number;
  magBright: number;
}

/**
 * Distance (parsecs) at which the chart-mode rendered disc reaches its
 * `uChartDiscMaxPx` plateau for a star of absolute magnitude `absMag`,
 * given the current `uChartMagBright` threshold. Solves `appMag =
 * magBright` from the standard distance modulus, giving
 * `d = 10^((magBright − absMag + 5)/5)`.
 *
 * Returns +Infinity when the star is intrinsically too dim to ever
 * plateau (`absMag > magBright + 5`) — the negative solution is
 * the right "never triggers" answer for plateau-gated callers.
 */
export function chartPlateauDistancePc(absMag: number, magBright: number): number {
  return Math.pow(10, (magBright - absMag + 5) / 5);
}

/**
 * Chart-mode rendered disc diameter (CSS pixels) for a star of apparent
 * magnitude `appMag`, mirroring the vertex shader's
 * `mix(maxPx, minPx, clamp((appMag − magBright) / (limitMag − magBright), 0, 1))`.
 * Returns `maxPx` at the bright end (`appMag ≤ magBright`) and `minPx`
 * at the instrument limit (`appMag = limitMag`).
 */
export function chartDiscPxForAppMag(
  appMag: number,
  params: ChartDiscParams,
  limitMag: number,
): number {
  const t = Math.max(0, Math.min(1,
    (appMag - params.magBright) /
      Math.max(limitMag - params.magBright, 0.001)));
  return params.maxPx + (params.minPx - params.maxPx) * t;
}
