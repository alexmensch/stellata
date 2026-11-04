import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dwellPacing, preconditionRefusal, recordCountRefusal } from '../diff/diff-pure';
import { CANON_POSITIONS } from '../pins/pin-pure';
import { frameFloor } from '../dwell/dwell-pure';
import { SCENARIO_NAMES, type ScenarioName } from '../scenarios';
import { assertPerfFile, type ScenarioRecord } from '../schema';
import {
  COMPUTE_SCATTER_FLOOR_MS, CPU_CLOCK_STEP_MS, CPU_SCATTER_FLOOR_MS, DWELL_FLOOR_FRACTION, DWELL_FLOOR_MS, computeFloorMs, cpuFloorMs, dwellFloorMs,
} from './floors';

/** The comparable population both per-vantage floors are derived from: every
 *  GPU-paced M6 dwell a gate would compare against the pin. README.md. */
const POPULATION_RUNS = [
  '.perf-runs/2026-11-03/8cg-49-42-gpu-all-3.json',
  '.perf-runs/2026-11-03/8cg-49-42-gpu-all-4.json',
  '.perf-runs/2026-11-04/8cg-49-38-m6-pin.json',
  '.perf-runs/2026-11-04/8cg-49-38-tier1-1.json',
  '.perf-runs/2026-11-04/8cg-49-38-tier1-2.json',
  '.perf-runs/2026-11-04/8cg-49-38-m6-check.json',
];

const POPULATION: readonly ScenarioRecord[] = POPULATION_RUNS
  .flatMap((path) => assertPerfFile(JSON.parse(readFileSync(path, 'utf-8')), path).scenarios);

function spanOf(name: ScenarioName, read: (r: ScenarioRecord) => number): number {
  const values = POPULATION.filter((r) => r.name === name).map(read);
  return Math.max(...values) - Math.min(...values);
}

describe('the floor population', () => {
  it('holds only rows a gate would compare against the pin', () => {
    const catalogue = POPULATION[0].recordCount;
    for (const r of POPULATION) {
      expect([r.name, dwellPacing(r), r.params.frames, r.bufferMpx, r.position,
        r.dwell?.throughputStats?.stateGuard, preconditionRefusal({}, r.params), recordCountRefusal(catalogue, r.recordCount)])
        .toEqual([r.name, 'gpu', 960, 4.096, CANON_POSITIONS.get(`${r.name}|${r.backend.actual}`), 'steady', null, null]);
    }
  });
});

describe('the whole-frame floor — one number, both gates', () => {
  it('is 0.25 ms or 1 % of the baseline, whichever is larger', () => {
    expect(DWELL_FLOOR_MS).toBe(0.25);
    expect(DWELL_FLOOR_FRACTION).toBe(0.01);
    expect(dwellFloorMs(10)).toBe(0.25);
    expect(dwellFloorMs(40)).toBe(0.4);
  });

  it('binds on the millisecond term at every canon row of the M6 pin, and on 1 % only past 25 ms', () => {
    expect(dwellFloorMs(13.147)).toBe(DWELL_FLOOR_MS);
    expect(dwellFloorMs(25)).toBe(DWELL_FLOOR_MS);
    expect(dwellFloorMs(31.451)).toBe(0.31451);
  });
});

describe('the compute floor', () => {
  it("is the vantage's own, not the whole-frame constant", () => {
    expect(COMPUTE_SCATTER_FLOOR_MS).toEqual({
      mw120: 0.05, sol: 0.60, earth: 0.55, mw50: 0.05, lg: 0.05,
    });
    expect(computeFloorMs('mw120', 0.413)).toBe(0.05);
    expect(computeFloorMs('mw50', 0.439)).toBe(0.05);
    expect(computeFloorMs('lg', 0.430)).toBe(0.05);
  });

  // A table that does not re-derive is one a later session re-litigates.
  it('holds each constant at 1.5× its p10 span over the population, up to 0.05', () => {
    for (const name of SCENARIO_NAMES) {
      const span = spanOf(name, (r) => frameFloor(r.dwell!.computeMs)!.p10);
      const derived = Number((Math.ceil(Number((1.5 * span / 0.05).toFixed(9))) * 0.05).toFixed(2));
      expect([name, COMPUTE_SCATTER_FLOOR_MS[name]]).toEqual([name, derived]);
    }
  });

  it('caps every vantage at the whole-frame floor, so no compute row is looser than a frame row', () => {
    expect(computeFloorMs('sol', 0.736)).toBe(DWELL_FLOOR_MS);
    expect(computeFloorMs('earth', 0.664)).toBe(DWELL_FLOOR_MS);
  });

  it('keeps the 1 % term, which binds on a compute row that has run away', () => {
    expect(computeFloorMs('mw120', 13.17)).toBeCloseTo(0.1317, 9);
  });
});

describe('the CPU floor', () => {
  it("is the vantage's own, uncapped", () => {
    expect(CPU_SCATTER_FLOOR_MS).toEqual({ mw120: 1.7, sol: 0.3, earth: 0.2, mw50: 0.3, lg: 0.1 });
    expect(cpuFloorMs('mw120', 1.6)).toBeCloseTo(1.75, 12);
    expect(cpuFloorMs('lg', 1.1)).toBeCloseTo(0.15, 12);
  });

  it('holds each constant at 1.5× its cpu-p50 span over the population, in whole clock steps', () => {
    for (const name of SCENARIO_NAMES) {
      const steps = Math.round(spanOf(name, (r) => r.dwell!.cpuStats!.p50) / CPU_CLOCK_STEP_MS);
      const derived = Number((Math.max(1, Math.ceil(1.5 * steps)) * CPU_CLOCK_STEP_MS).toFixed(1));
      expect([name, CPU_SCATTER_FLOOR_MS[name]]).toEqual([name, derived]);
    }
  });
});
