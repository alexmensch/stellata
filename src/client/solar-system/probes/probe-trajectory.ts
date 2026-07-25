// Runtime probe trajectory: a parsed wire file plus the position/velocity
// sampler every probe consumer reads. See README.md § Sampler.

import { PROBE_SAMPLE_STRIDE, type ProbeTrajectoryFile } from '../../../../scripts/probes/probe-trajectory-schema';
import { AU_PC } from '../../util/astronomy-constants';
import { jdeToT } from '../time/time';

const SECONDS_PER_DAY = 86400;

export interface ProbeState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface ProbeTrajectory {
  readonly id: string;
  readonly label: string;
  readonly mission: string;
  readonly launchUtc: string;
  /** Model-time seconds of last contact; null while the probe transmits. */
  readonly lastContactT: number | null;
  /** Ascending sample epochs, model-time seconds. */
  readonly sampleT: Float64Array;
  /** Heliocentric ICRS position per sample, parsecs, xyz-interleaved. */
  readonly posPc: Float64Array;
  /** Heliocentric ICRS velocity per sample, parsecs per second. */
  readonly velPcPerSec: Float64Array;
}

/** First epoch the trajectory covers, model-time seconds. Visibility gates
 *  here and never on launch: Voyager 1's SPK starts 1977-09-06, a day after
 *  its launch, so a launch-keyed gate shows a probe with no position. */
export function probeFirstSampleT(traj: ProbeTrajectory): number {
  return traj.sampleT[0];
}

export function probeSampleCount(traj: ProbeTrajectory): number {
  return traj.sampleT.length;
}

/** Parse one wire file into typed arrays, converting AU → pc and AU/day →
 *  pc/s at load so every downstream reader works in scene units. */
export function buildProbeTrajectory(file: ProbeTrajectoryFile): ProbeTrajectory {
  const n = file.samples.length;
  if (n === 0) throw new Error(`Probe ${file.id} carries no samples`);
  const sampleT = new Float64Array(n);
  const posPc = new Float64Array(n * 3);
  const velPcPerSec = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const row = file.samples[i];
    if (row.length !== PROBE_SAMPLE_STRIDE) {
      throw new Error(`Probe ${file.id} sample ${i} has ${row.length} columns`);
    }
    sampleT[i] = jdeToT(row[0]);
    for (let c = 0; c < 3; c++) {
      posPc[i * 3 + c] = row[1 + c] * AU_PC;
      velPcPerSec[i * 3 + c] = (row[4 + c] * AU_PC) / SECONDS_PER_DAY;
    }
  }
  return {
    id: file.id,
    label: file.label,
    mission: file.mission,
    launchUtc: file.launchUtc,
    lastContactT: file.lastContactUnixMs === null ? null : file.lastContactUnixMs / 1000,
    sampleT,
    posPc,
    velPcPerSec,
  };
}

/**
 * Index of the last sample at or before `t`: -1 before the first sample,
 * and the final index once `t` passes the last one (where the sampler
 * coasts on the stored velocity). Binary search — a scrub can jump
 * decades between frames, so a cursor walk would be no cheaper.
 */
export function probeSampleIndexAt(sampleT: Float64Array, t: number): number {
  if (t < sampleT[0]) return -1;
  let lo = 0;
  let hi = sampleT.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sampleT[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Heliocentric ICRS state at model time `t` into `out`; false (and `out`
 * untouched) before the first sample, which is the visibility gate.
 *
 * Linear interpolation between the 30-day samples, and linear coasting on
 * the final sample's velocity past the ephemeris end (2050). Coasting is
 * why the whole clamp range stays defined: past Neptune the trajectory is
 * a straight line to well under the ~0.3 AU coherence budget, and freezing
 * the probe instead would strand it while the planets kept moving.
 */
export function probeStateAt(traj: ProbeTrajectory, t: number, out: ProbeState): boolean {
  const k = probeSampleIndexAt(traj.sampleT, t);
  if (k < 0) return false;
  const base = k * 3;
  const last = traj.sampleT.length - 1;
  if (k === last) {
    const dt = t - traj.sampleT[k];
    out.vx = traj.velPcPerSec[base];
    out.vy = traj.velPcPerSec[base + 1];
    out.vz = traj.velPcPerSec[base + 2];
    out.x = traj.posPc[base] + out.vx * dt;
    out.y = traj.posPc[base + 1] + out.vy * dt;
    out.z = traj.posPc[base + 2] + out.vz * dt;
    return true;
  }
  const next = base + 3;
  const f = (t - traj.sampleT[k]) / (traj.sampleT[k + 1] - traj.sampleT[k]);
  out.x = traj.posPc[base] + (traj.posPc[next] - traj.posPc[base]) * f;
  out.y = traj.posPc[base + 1] + (traj.posPc[next + 1] - traj.posPc[base + 1]) * f;
  out.z = traj.posPc[base + 2] + (traj.posPc[next + 2] - traj.posPc[base + 2]) * f;
  out.vx = traj.velPcPerSec[base] + (traj.velPcPerSec[next] - traj.velPcPerSec[base]) * f;
  out.vy = traj.velPcPerSec[base + 1]
    + (traj.velPcPerSec[next + 1] - traj.velPcPerSec[base + 1]) * f;
  out.vz = traj.velPcPerSec[base + 2]
    + (traj.velPcPerSec[next + 2] - traj.velPcPerSec[base + 2]) * f;
  return true;
}

/** Whether `t` is past the probe's last contact — the dim + label-suffix
 *  condition for the two Pioneers. Still-transmitting probes never are. */
export function probeSignalLost(traj: ProbeTrajectory, t: number): boolean {
  return traj.lastContactT !== null && t > traj.lastContactT;
}

/** Marker label: the mission name, suffixed once the signal is gone so a
 *  silent probe still on its coasting trajectory reads as one. */
export function probeLabelText(traj: ProbeTrajectory, t: number): string {
  return probeSignalLost(traj, t) ? `${traj.label} (signal lost)` : traj.label;
}
