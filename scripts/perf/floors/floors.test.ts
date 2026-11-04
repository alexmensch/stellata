import { describe, expect, it } from 'vitest';
import type { ScenarioName } from '../scenarios';
import {
  COMPUTE_SCATTER_FLOOR_MS, CPU_SCATTER_FLOOR_MS, DWELL_FLOOR_FRACTION, DWELL_FLOOR_MS, computeFloorMs, cpuFloorMs, dwellFloorMs,
} from './floors';

describe('the whole-frame floor — one number, both gates', () => {
  it('is 0.25 ms or 1 % of the baseline, whichever is larger', () => {
    expect(DWELL_FLOOR_MS).toBe(0.25);
    expect(DWELL_FLOOR_FRACTION).toBe(0.01);
    expect(dwellFloorMs(10)).toBe(0.25);
    expect(dwellFloorMs(40)).toBe(0.4);
  });

  it('binds on the millisecond term at every canon row but mw50, where 1 % is larger', () => {
    expect(dwellFloorMs(21.8)).toBe(DWELL_FLOOR_MS);
    expect(dwellFloorMs(16.9)).toBe(DWELL_FLOOR_MS);
    expect(dwellFloorMs(31.451)).toBe(0.31451);
  });
});

describe('the compute floor', () => {
  it("is the vantage's own, not the whole-frame constant", () => {
    expect(COMPUTE_SCATTER_FLOOR_MS).toEqual({
      mw120: 0.05, sol: 0.15, earth: 0.10, mw50: 0.05, lg: 0.45,
    });
    expect(computeFloorMs('mw120', 0.289)).toBe(0.05);
    expect(computeFloorMs('mw50', 0.308)).toBe(0.05);
    expect(computeFloorMs('earth', 0.318)).toBe(0.10);
  });

  // A table that does not re-derive is one a later session re-litigates.
  it('holds each constant at the derivation the README states', () => {
    const POPULATION_SPAN_MS = {
      mw120: 0.023, sol: 0.087, earth: 0.057, mw50: 0.008, lg: 0.267,
    } as const;
    for (const [name, span] of Object.entries(POPULATION_SPAN_MS)) {
      const derived = Number((Math.ceil((1.5 * span) / 0.05) * 0.05).toFixed(2));
      expect([name, COMPUTE_SCATTER_FLOOR_MS[name as ScenarioName]]).toEqual([name, derived]);
    }
  });

  it('falls back to the whole-frame floor for a vantage off the canon', () => {
    expect(computeFloorMs('mw90' as ScenarioName, 0.3)).toBe(DWELL_FLOOR_MS);
  });

  it('caps every vantage at the whole-frame floor, so a re-floor only tightens', () => {
    expect(computeFloorMs('lg', 0.589)).toBe(DWELL_FLOOR_MS);
    expect(computeFloorMs('sol', 0.446)).toBe(0.15);
  });

  it('keeps the 1 % term, which binds on a compute row that has run away', () => {
    expect(computeFloorMs('mw120', 13.17)).toBeCloseTo(0.1317, 9);
  });
});

describe('the CPU floor', () => {
  it("is the vantage's own, uncapped", () => {
    expect(CPU_SCATTER_FLOOR_MS).toEqual({ mw120: 1.7, sol: 0.3, earth: 0.2, mw50: 0.3, lg: 0.1 });
    expect(cpuFloorMs('mw120', 1.6)).toBe(1.7);
    expect(cpuFloorMs('lg', 1.1)).toBe(0.1);
  });

  // Spans in the clock's 0.1 ms steps, as integers, so the rounding is exact.
  it('holds each constant at the derivation the README states', () => {
    const POPULATION_SPAN_TENTHS = { mw120: 11, sol: 2, earth: 1, mw50: 2, lg: 0 } as const;
    for (const [name, span] of Object.entries(POPULATION_SPAN_TENTHS)) {
      const derived = Math.max(1, Math.ceil(1.5 * span)) / 10;
      expect([name, CPU_SCATTER_FLOOR_MS[name as ScenarioName]]).toEqual([name, derived]);
    }
  });

  it('falls back to the whole-frame floor for a vantage off the canon', () => {
    expect(cpuFloorMs('mw90' as ScenarioName, 1.4)).toBe(DWELL_FLOOR_MS);
  });
});
