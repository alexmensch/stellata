// The floor under every dwell band, shared by --baseline and --against-pin.
// Derivations: README.md.

import type { ScenarioName } from '../scenarios';

/** README.md#the-whole-frame-floor */
export const DWELL_FLOOR_MS = 0.25;
export const DWELL_FLOOR_FRACTION = 0.01;

/** 1.5× each vantage's p10 scatter, rounded up to 0.05 — README.md#the-compute-floor. */
export const COMPUTE_SCATTER_FLOOR_MS: Readonly<Record<ScenarioName, number>> = {
  mw120: 0.05,
  sol: 0.15,
  earth: 0.10,
  mw50: 0.05,
  lg: 0.45,
};

function floorFor(floorMs: number, baselineMs: number): number {
  return Math.max(floorMs, DWELL_FLOOR_FRACTION * baselineMs);
}

export function dwellFloorMs(baselineMs: number): number {
  return floorFor(DWELL_FLOOR_MS, baselineMs);
}

/** README.md#the-compute-floor */
export function computeFloorMs(name: ScenarioName, baselineMs: number): number {
  const derived: number | undefined = COMPUTE_SCATTER_FLOOR_MS[name];
  return floorFor(Math.min(derived ?? DWELL_FLOOR_MS, DWELL_FLOOR_MS), baselineMs);
}
