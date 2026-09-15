// Throwaway spike instrument: the ray geometries the WebGPU volume-fetch
// throughput probe dispatches. What each row means and why they are on by
// default: README.md § The throughput spike rows.

import { DUST_STEPS } from '../../../star-pipeline/extinction/dust-raymarch-pure';

/** `coherent` lays rays on an angular grid, so consecutive threads are one
 *  `pitchArcmin` apart on the sky. `scattered` is a golden-angle spiral with
 *  star-like ray lengths — the per-star prepass's shape, and the floor. */
export type VolumeMarchPattern = 'coherent' | 'scattered';

/** Half a 4.88 pc Edenhofer voxel: the rate the froxel fill marches each ray
 *  at (`docs/science-galactic-structure.md` § Cost). */
const HALF_VOXEL_PC = 2.44;

/** One ray whose `DUST_STEPS` taps land exactly a half-voxel apart, which is
 *  the fill's own along-ray sampling. */
const FILL_RANGE_PC = HALF_VOXEL_PC * DUST_STEPS;

/** The long ray of the first run: taps 25 pc apart, five voxels, so
 *  along-ray locality is far worse than the fill's. Kept so two rows
 *  reproduce that run exactly and the two sessions can be compared. */
const FAR_RANGE_PC = 1200;

/** Every row dispatches this many rays, so `savedMs` is directly comparable
 *  across rows and only the geometry varies. */
const RAYS = 2_097_152;
const GRID_W = 2048;

/** The pinned froxel cell — one summation-patch diameter. */
const PIN_ARCMIN = 13.0;

/** Rows 3-6 are a 2x2 over the two locality axes, transverse and along-ray,
 *  because the first run varied both at once and its coherent rate could
 *  only be read as a bound. Rows 1-2 reproduce that run's geometry
 *  unchanged, so the two sessions are comparable rather than merely
 *  consecutive. */
export const VOLUME_PROBE_SPECS = [
  { key: 'volCohCtl', pattern: 'coherent', pitchArcmin: 1.46, rangePc: FAR_RANGE_PC },
  { key: 'volSctCtl', pattern: 'scattered', pitchArcmin: 0, rangePc: FAR_RANGE_PC },
  { key: 'volPin13', pattern: 'coherent', pitchArcmin: PIN_ARCMIN, rangePc: FILL_RANGE_PC },
  { key: 'volPin26', pattern: 'coherent', pitchArcmin: 26.0, rangePc: FILL_RANGE_PC },
  { key: 'volPin13far', pattern: 'coherent', pitchArcmin: PIN_ARCMIN, rangePc: FAR_RANGE_PC },
  { key: 'volPin1p5near', pattern: 'coherent', pitchArcmin: 1.46, rangePc: FILL_RANGE_PC },
] as const satisfies readonly {
  key: string;
  pattern: VolumeMarchPattern;
  /** Angle between neighbouring rays. Zero for the scattered pattern. */
  pitchArcmin: number;
  rangePc: number;
}[];

export type VolumeProbeSpec = (typeof VOLUME_PROBE_SPECS)[number];
export type VolumeProbeKey = VolumeProbeSpec['key'];

export const VOLUME_PROBE_KEYS: readonly VolumeProbeKey[] =
  VOLUME_PROBE_SPECS.map((s) => s.key);

export const PROBE_RAYS = RAYS;
export const PROBE_GRID_W = GRID_W;

/** Exact, not a ceiling: every tap is inside the volume, so none is lost to
 *  the march's bbox test. Identical for every row by construction. */
export function probeFetches(): number {
  return RAYS * DUST_STEPS;
}

/** Distance between neighbouring rays at the far end of the march — the
 *  quantity the transverse half of the locality question turns on, against a
 *  4.88 pc voxel. */
export function rayPitchAtRangePc(spec: VolumeProbeSpec): number {
  return spec.rangePc * (spec.pitchArcmin / 60) * (Math.PI / 180);
}

/** Threads race for a slot here deliberately — the value is never read, and
 *  the write is only what stops the march being eliminated. One output per
 *  ray would be 8 MiB of VRAM per row. */
export const PROBE_SINK_SLOTS = 1024;

/** Azimuth period, in threads, so the golden-angle argument to cos/sin stays
 *  inside float32's useful range. */
export const PROBE_AZIMUTH_PERIOD = 65_536;
