// Throwaway spike instrument: the dispatch sweep the WebGPU volume-fetch
// throughput probe runs, and the exact fetch count each dispatch issues.
// Deleted with the kernel once the numbers are recorded.

import { DUST_STEPS } from '../../../star-pipeline/extinction/dust-raymarch-pure';

/** How neighbouring threads' rays relate. `coherent` is the froxel fill's
 *  shape — a screen-space grid of directions, adjacent threads adjacent on
 *  the sky. `scattered` is the per-star prepass's — one origin, directions
 *  a golden angle apart, so consecutive threads share no footprint. */
export type VolumeMarchPattern = 'coherent' | 'scattered';

/** Three dispatch sizes per pattern, 4× apart end to end: one point is a
 *  cost, three are a rate that either holds or does not. Keys carry their
 *  own fetch count because they are read as perf-table row labels. */
export const VOLUME_PROBE_SPECS = [
  { key: 'volFetchCoh50M', pattern: 'coherent', rays: 1_048_576, gridW: 1024 },
  { key: 'volFetchCoh101M', pattern: 'coherent', rays: 2_097_152, gridW: 2048 },
  { key: 'volFetchCoh201M', pattern: 'coherent', rays: 4_194_304, gridW: 2048 },
  { key: 'volFetchSct50M', pattern: 'scattered', rays: 1_048_576, gridW: 1 },
  { key: 'volFetchSct101M', pattern: 'scattered', rays: 2_097_152, gridW: 1 },
  { key: 'volFetchSct201M', pattern: 'scattered', rays: 4_194_304, gridW: 1 },
] as const satisfies readonly {
  key: string;
  pattern: VolumeMarchPattern;
  rays: number;
  /** Row width of the coherent pattern's direction grid; `rays / gridW` is
   *  its height. Unread by the scattered pattern. */
  gridW: number;
}[];

export type VolumeProbeSpec = (typeof VOLUME_PROBE_SPECS)[number];
export type VolumeProbeKey = VolumeProbeSpec['key'];

export const VOLUME_PROBE_KEYS: readonly VolumeProbeKey[] =
  VOLUME_PROBE_SPECS.map((s) => s.key);

/** Every ray marches the shared `dustRaymarchAvTsl` graph, whose loop is
 *  `DUST_STEPS` taps, and the probe keeps every tap inside the volume — so
 *  the count is exact rather than a ceiling. */
export function probeFetches(spec: VolumeProbeSpec): number {
  return spec.rays * DUST_STEPS;
}

/** Ray length, in parsecs. Inside the 1250 pc half-extent of the Edenhofer
 *  cube along every axis, which is what keeps every tap a real fetch rather
 *  than a bbox-test miss. */
export const PROBE_RANGE_PC = 1200;

/** The default view's field of view, which the coherent grid spans — the
 *  frustum the cost table's 50° row is filled over. */
export const PROBE_FOV_DEG = 50;

/** Slots the kernel scatters its results into. The value is never read; the
 *  write exists so the march cannot be eliminated, and threads race for a
 *  slot deliberately rather than each owning one — a per-ray output would be
 *  16 MiB of VRAM at the largest dispatch. */
export const PROBE_SINK_SLOTS = 1024;

/** Azimuth period of the scattered pattern, in threads. The golden-angle
 *  azimuth is taken modulo this so the argument to cos/sin stays inside
 *  float32's useful range at a 4.2M dispatch; consecutive threads still land
 *  a golden angle apart, which is the property being measured. */
export const PROBE_AZIMUTH_PERIOD = 65_536;
