import { describe, expect, it } from 'vitest';
import { DUST_STEPS } from '../../../star-pipeline/extinction/dust-raymarch-pure';
import {
  PROBE_AZIMUTH_PERIOD, PROBE_GRID_W, PROBE_RAYS, PROBE_SINK_SLOTS,
  VOLUME_PROBE_KEYS, VOLUME_PROBE_SPECS, probeFetches, rayPitchAtRangePc,
} from './volume-probe-specs';

// The half-extent of the Edenhofer cube the loader reports
// (loaders/dust-loader.ts), and the voxel it is diced into. A ray reaching
// past the first leaves the volume and the march's bbox test skips the tap.
const DUST_BOUNDS_HALF_PC = 1250;
const VOXEL_PC = 4.88;

describe('the throughput sweep', () => {
  it('issues one exact fetch count, the same for every row', () => {
    expect(DUST_STEPS).toBe(48);
    expect(probeFetches()).toBe(100_663_296);
    expect(PROBE_RAYS).toBe(2_097_152);
  });

  it('keeps every tap inside the volume, so the count stays exact', () => {
    for (const spec of VOLUME_PROBE_SPECS) {
      expect(spec.rangePc, spec.key).toBeLessThan(DUST_BOUNDS_HALF_PC);
    }
  });

  // The first run swept dispatch size and angular pitch together, so its
  // coherent rate could only be read as a bound. These four separate them.
  it('crosses the two locality axes, so neither confounds the other', () => {
    const cell = (key: string) => {
      const spec = VOLUME_PROBE_SPECS.find((s) => s.key === key)!;
      return {
        transverse: rayPitchAtRangePc(spec) / VOXEL_PC,
        alongRay: spec.rangePc / DUST_STEPS / VOXEL_PC,
      };
    };
    // Taps half a voxel apart is the fill's own rate; five voxels is the
    // long ray the first run measured.
    expect(cell('volPin13').alongRay).toBeCloseTo(0.5, 2);
    expect(cell('volPin13far').alongRay).toBeCloseTo(5.12, 2);
    // At the pin, neighbouring rays are about one voxel apart at the far end
    // — the regime the first run never sampled.
    expect(cell('volPin13').transverse).toBeCloseTo(0.0908, 4);
    expect(cell('volPin13far').transverse).toBeCloseTo(0.93, 2);
    // …against a control whose neighbours sit well inside one voxel.
    expect(cell('volCohCtl').transverse).toBeCloseTo(0.104, 3);
    expect(cell('volPin1p5near').transverse).toBeCloseTo(0.0102, 4);
  });

  it('reproduces the first run in two rows, so the sessions compare', () => {
    const ctl = VOLUME_PROBE_SPECS.filter((s) => s.key.endsWith('Ctl'));
    expect(ctl.map((s) => s.pattern)).toEqual(['coherent', 'scattered']);
    for (const spec of ctl) expect(spec.rangePc, spec.key).toBe(1200);
  });

  it('gives the coherent grid whole rows', () => {
    expect(Number.isInteger(PROBE_RAYS / PROBE_GRID_W)).toBe(true);
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
