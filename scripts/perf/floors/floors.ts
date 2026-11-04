// The floor under every dwell band, shared by --baseline and --against-pin.
// Derivations: README.md.

import type { ScenarioName } from '../scenarios';

/** README.md#the-whole-frame-floor */
export const DWELL_FLOOR_MS = 0.25;
export const DWELL_FLOOR_FRACTION = 0.01;

/** 1.5× each vantage's p10 scatter, rounded up to 0.05 — README.md#the-compute-floor. */
export const COMPUTE_SCATTER_FLOOR_MS: Readonly<Record<ScenarioName, number>> = {
  mw120: 0.05,
  sol: 0.60,
  earth: 0.25,
  mw50: 0.05,
  lg: 0.05,
};

/** 1.5× each vantage's cpu-p50 scatter, rounded up to the 0.1 ms the clock
 *  resolves and never under it — README.md#the-cpu-floor. */
export const CPU_SCATTER_FLOOR_MS: Readonly<Record<ScenarioName, number>> = {
  mw120: 1.7,
  sol: 0.3,
  earth: 0.2,
  mw50: 0.3,
  lg: 0.1,
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

/** Uncapped, unlike the compute floor — README.md#the-cpu-floor. */
export function cpuFloorMs(name: ScenarioName, baselineMs: number): number {
  const derived: number | undefined = CPU_SCATTER_FLOOR_MS[name];
  return floorFor(derived ?? DWELL_FLOOR_MS, baselineMs);
}
