import { describe, expect, it } from 'vitest';
import { AU_PC } from '../../util/astronomy-constants';
import { jdeToT, T_CLAMP_MAX_S, tToJDE } from '../time/time';
import type { ProbeTrajectoryFile } from '../../../../scripts/probes/probe-trajectory-schema';
import {
  buildProbeTrajectory,
  probeLabelText,
  probeSampleIndexAt,
  probeSignalLost,
  probeStateAt,
  type ProbeState,
} from './probe-trajectory';

const STEP_DAYS = 30;
// Launch sits at the Unix epoch; the first ephemeris sample lands 30 days
// later, the exaggerated form of Voyager 1's one-day SPK-after-launch gap.
const LAUNCH_JD = tToJDE(0);
const FIRST_JD = LAUNCH_JD + STEP_DAYS;

// Three samples marching +1 AU along ICRS x every 30 days at a matching
// constant velocity, so interpolation, coasting, and the AU→pc conversion
// all have exact expected values.
function makeFile(lastContactUnixMs: number | null = null): ProbeTrajectoryFile {
  const vxAuPerDay = 1 / STEP_DAYS;
  return {
    id: 'testprobe',
    label: 'Test Probe',
    mission: 'Fixture.',
    horizonsId: '-1',
    launchUtc: '1970-01-01T00:00:00Z',
    launchUnixMs: 0,
    lastContactUtc: null,
    lastContactUnixMs,
    source: {
      frame: 'ICRF', center: 'Sun (10)', units: 'AU-D',
      targetBody: 'Test', retrievedUtc: '2026-07-25T00:00:00Z',
    },
    columns: ['jd', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
    samples: [0, 1, 2].map((i) => [
      FIRST_JD + i * STEP_DAYS, i, 0, 0, vxAuPerDay, 0, 0,
    ]),
  };
}

const out: ProbeState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

describe('buildProbeTrajectory', () => {
  it('converts AU → pc and AU/day → pc/s', () => {
    const traj = buildProbeTrajectory(makeFile());
    expect(traj.posPc[3]).toBeCloseTo(AU_PC, 12);
    expect(traj.velPcPerSec[0]).toBeCloseTo(AU_PC / STEP_DAYS / 86400, 20);
    expect(traj.sampleT[0]).toBe(jdeToT(FIRST_JD));
  });

  it('reads lastContact as seconds from the wire file milliseconds', () => {
    const traj = buildProbeTrajectory(makeFile(1_043_280_000_000));
    expect(traj.lastContactT).toBe(1_043_280_000);
  });

  it('rejects a row whose column count disagrees with the schema stride', () => {
    const file = makeFile();
    file.samples[1] = [FIRST_JD + STEP_DAYS, 1, 0, 0];
    expect(() => buildProbeTrajectory(file)).toThrow(/columns/);
  });
});

describe('probeSampleIndexAt', () => {
  const { sampleT } = buildProbeTrajectory(makeFile());

  it('returns -1 before the first sample', () => {
    expect(probeSampleIndexAt(sampleT, sampleT[0] - 1)).toBe(-1);
  });

  it('brackets on the sample at or before t', () => {
    expect(probeSampleIndexAt(sampleT, sampleT[0])).toBe(0);
    expect(probeSampleIndexAt(sampleT, sampleT[1] - 1)).toBe(0);
    expect(probeSampleIndexAt(sampleT, sampleT[1])).toBe(1);
  });

  it('pins at the final sample past the ephemeris end', () => {
    expect(probeSampleIndexAt(sampleT, sampleT[2] + 1e9)).toBe(2);
  });
});

describe('probeStateAt', () => {
  const traj = buildProbeTrajectory(makeFile());

  it('gates on the first sample, not the launch instant', () => {
    expect(probeStateAt(traj, jdeToT(LAUNCH_JD), out)).toBe(false);
    expect(probeStateAt(traj, traj.sampleT[0] - 1, out)).toBe(false);
    expect(probeStateAt(traj, traj.sampleT[0], out)).toBe(true);
  });

  it('interpolates linearly between samples', () => {
    const mid = (traj.sampleT[0] + traj.sampleT[1]) / 2;
    expect(probeStateAt(traj, mid, out)).toBe(true);
    expect(out.x).toBeCloseTo(0.5 * AU_PC, 12);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it('coasts on the final velocity past the last sample', () => {
    const oneYearPast = traj.sampleT[2] + 365 * 86400;
    expect(probeStateAt(traj, oneYearPast, out)).toBe(true);
    // 2 AU at the last sample plus 365/30 AU of coasting.
    expect(out.x / AU_PC).toBeCloseTo(2 + 365 / STEP_DAYS, 9);
  });

  it('stays defined out to the model clock clamp', () => {
    // The real files stop at 2050; the clamp reaches 3000 AD, so every
    // reachable `t` past the ephemeris end has to resolve by coasting.
    expect(probeStateAt(traj, T_CLAMP_MAX_S, out)).toBe(true);
    expect(Number.isFinite(out.x)).toBe(true);
  });
});

describe('signal-lost state', () => {
  const active = buildProbeTrajectory(makeFile());
  const lost = buildProbeTrajectory(makeFile(1_043_280_000_000));

  it('is never lost for a still-transmitting probe', () => {
    expect(probeSignalLost(active, 4e9)).toBe(false);
    expect(probeLabelText(active, 4e9)).toBe('Test Probe');
  });

  it('flips at the last-contact epoch and suffixes the label', () => {
    expect(probeSignalLost(lost, 1_043_280_000 - 1)).toBe(false);
    expect(probeSignalLost(lost, 1_043_280_000 + 1)).toBe(true);
    expect(probeLabelText(lost, 1_043_280_000 + 1)).toBe('Test Probe (signal lost)');
  });
});
