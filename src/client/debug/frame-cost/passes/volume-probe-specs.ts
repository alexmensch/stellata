// Throwaway spike instrument: the dispatch sweep the WebGPU volume-fetch
// throughput probe runs. What each row means and why they are on by
// default: README.md § The throughput spike rows.

import { DUST_STEPS } from '../../../star-pipeline/extinction/dust-raymarch-pure';

export type VolumeMarchPattern = 'coherent' | 'scattered';

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
  /** Row width of the coherent grid; `rays / gridW` is its height. */
  gridW: number;
}[];

export type VolumeProbeSpec = (typeof VOLUME_PROBE_SPECS)[number];
export type VolumeProbeKey = VolumeProbeSpec['key'];

export const VOLUME_PROBE_KEYS: readonly VolumeProbeKey[] =
  VOLUME_PROBE_SPECS.map((s) => s.key);

/** Exact, not a ceiling: every tap is inside the volume, so none is lost to
 *  the march's bbox test. */
export function probeFetches(spec: VolumeProbeSpec): number {
  return spec.rays * DUST_STEPS;
}

/** Ray length in parsecs. Must stay under the Edenhofer cube's 1250 pc
 *  half-extent or `probeFetches` stops being exact. */
export const PROBE_RANGE_PC = 1200;

export const PROBE_FOV_DEG = 50;

/** Threads race for a slot here deliberately — the value is never read, and
 *  the write is only what stops the march being eliminated. One output per
 *  ray would be 16 MiB of VRAM at the largest dispatch. */
export const PROBE_SINK_SLOTS = 1024;

/** Azimuth period, in threads, so the golden-angle argument to cos/sin stays
 *  inside float32's useful range at a 4.2M dispatch. */
export const PROBE_AZIMUTH_PERIOD = 65_536;
