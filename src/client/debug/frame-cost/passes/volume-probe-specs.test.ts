import { describe, expect, it } from 'vitest';
import { DUST_STEPS } from '../../../star-pipeline/extinction/dust-raymarch-pure';
import {
  PROBE_AZIMUTH_PERIOD, PROBE_RANGE_PC, PROBE_SINK_SLOTS, VOLUME_PROBE_KEYS,
  VOLUME_PROBE_SPECS, probeFetches,
} from './volume-probe-specs';

// The half-extent of the Edenhofer cube the loader reports
// (loaders/dust-loader.ts). A ray reaching past it leaves the volume, the
// march's bbox test skips the tap, and the fetch count stops being exact.
const DUST_BOUNDS_HALF_PC = 1250;

describe('the throughput sweep', () => {
  it('issues the fetch counts its keys name', () => {
    const fetches = VOLUME_PROBE_SPECS.map(probeFetches);
    expect(fetches).toEqual([
      50_331_648, 100_663_296, 201_326_592,
      50_331_648, 100_663_296, 201_326_592,
    ]);
    expect(DUST_STEPS).toBe(48);
  });

  it('spans 4x end to end per pattern, so the rate is a slope', () => {
    const coherent = VOLUME_PROBE_SPECS.filter((s) => s.pattern === 'coherent');
    const scattered = VOLUME_PROBE_SPECS.filter((s) => s.pattern === 'scattered');
    for (const set of [coherent, scattered]) {
      expect(set).toHaveLength(3);
      expect(set[2]!.rays / set[0]!.rays).toBe(4);
    }
  });

  it('gives the coherent grid whole rows', () => {
    for (const spec of VOLUME_PROBE_SPECS) {
      if (spec.pattern !== 'coherent') continue;
      expect(Number.isInteger(spec.rays / spec.gridW), spec.key).toBe(true);
    }
  });

  it('keeps every tap inside the volume, so the count is exact', () => {
    expect(PROBE_RANGE_PC).toBeLessThan(DUST_BOUNDS_HALF_PC);
  });

  it('scatters into a power-of-two sink the bitmask can address', () => {
    expect(PROBE_SINK_SLOTS & (PROBE_SINK_SLOTS - 1)).toBe(0);
    expect(PROBE_AZIMUTH_PERIOD & (PROBE_AZIMUTH_PERIOD - 1)).toBe(0);
  });

  it('names each row once, matching the specs', () => {
    expect([...VOLUME_PROBE_KEYS]).toEqual(VOLUME_PROBE_SPECS.map((s) => s.key));
    expect(new Set(VOLUME_PROBE_KEYS).size).toBe(VOLUME_PROBE_KEYS.length);
  });
});
