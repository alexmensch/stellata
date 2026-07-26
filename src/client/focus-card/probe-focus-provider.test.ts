import { describe, expect, it, beforeEach } from 'vitest';
import { AU_PC, KM_PC } from '../util/astronomy-constants';
import { setUnit } from '../ui/distance-util';
import type { ProbeTrajectory } from '../solar-system/probes/probe-trajectory';
import { createProbeFocusProvider, type ProbeFocusProviderConfig } from './probe-focus-provider';

const PIONEER_10: ProbeTrajectory = {
  id: 'pioneer10',
  label: 'Pioneer 10',
  mission: 'First probe to Jupiter (1973) and first on a Sun-escape trajectory.',
  launchUtc: '1972-03-03T01:49:00Z',
  lastContactT: Date.UTC(2003, 0, 23) / 1000,
  sampleT: new Float64Array([0]),
  posPc: new Float64Array([0, 0, 0]),
  velPcPerSec: new Float64Array([0, 0, 0]),
};

function makeProvider(patch: Partial<ProbeFocusProviderConfig> = {}) {
  return createProbeFocusProvider({
    probeAt: () => PIONEER_10,
    cameraDistancePc: () => 10 * KM_PC,
    solDistancePc: () => 143 * AU_PC,
    speedPcPerSec: () => 11.94 * KM_PC,
    signalLost: () => true,
    ...patch,
  });
}

const rowsOf = (p: ReturnType<typeof makeProvider>) =>
  new Map(p.format(0).rows.map((r) => [r.label, r.value]));

const valueOf = (v: string | (() => string) | undefined): string =>
  typeof v === 'function' ? v() : v ?? '';

describe('createProbeFocusProvider', () => {
  beforeEach(() => setUnit('pc'));

  it('leads with the identity line and the mission summary line', () => {
    const card = makeProvider().format(0);
    expect(card.name).toBe('Pioneer 10');
    expect(card.identityLines).toEqual(['Deep-space probe']);
    expect(card.lines).toEqual([PIONEER_10.mission]);
  });

  it('keeps the camera-frame Distance row distinct from the Sol-relative one', () => {
    const rows = rowsOf(makeProvider());
    expect(valueOf(rows.get('From Sol'))).toBe('143.0 AU (19.8 lt-hr)');
    // Camera distance is metres-to-thousands-of-km at a probe park, so it
    // can never be confused with the AU figure beside it.
    expect(valueOf(rows.get('Distance'))).not.toContain('143');
  });

  it('reads speed from the sampler velocity, and dates a lost signal', () => {
    const rows = rowsOf(makeProvider());
    expect(valueOf(rows.get('Speed'))).toBe('11.94 km/s');
    expect(valueOf(rows.get('Launched'))).toBe('1972-03-03');
    expect(valueOf(rows.get('Signal'))).toBe('Lost 2003-01-23');
  });

  // Distance / From Sol / Speed / Signal are all functions of the model
  // clock or the camera, so all four must be LIVE rows — a static Signal
  // would keep reading "Lost" after a scrub back to the 1990s.
  it('marks every clock- or camera-driven row LIVE', () => {
    const rows = rowsOf(makeProvider());
    for (const label of ['Distance', 'From Sol', 'Speed', 'Signal']) {
      expect(typeof rows.get(label), label).toBe('function');
    }
    expect(typeof rows.get('Launched')).toBe('string');
  });

  it('dashes the sampled rows before the trajectory covers the clock', () => {
    const rows = rowsOf(makeProvider({
      cameraDistancePc: () => null,
      solDistancePc: () => null,
      speedPcPerSec: () => null,
    }));
    expect(valueOf(rows.get('Distance'))).toBe('—');
    expect(valueOf(rows.get('From Sol'))).toBe('—');
    expect(valueOf(rows.get('Speed'))).toBe('—');
  });

  it('returns an empty card when no probe occupies the index', () => {
    const provider = makeProvider({ probeAt: () => null });
    expect(provider.format(0)).toEqual({ name: '', identityLines: [], rows: [], lines: [] });
  });
});
