import { describe, expect, it } from 'vitest';

import { AU_PC, KM_PC } from '../util/astronomy-constants';
import {
  formatProbeLaunch,
  formatProbeSignal,
  formatProbeSpeed,
  formatSolDistance,
} from './probe-format';

describe('formatSolDistance', () => {
  it('pairs AU with the light-time to the spacecraft', () => {
    // 1 AU is 499.0 light-seconds = 0.1386 light-hours.
    expect(formatSolDistance(AU_PC)).toBe('1.0 AU (0.1 lt-hr)');
  });

  it('reads Voyager 1 at its 2026 distance', () => {
    expect(formatSolDistance(167 * AU_PC)).toBe('167.0 AU (23.1 lt-hr)');
  });
});

describe('formatProbeSpeed', () => {
  it('converts the sampler velocity from pc/s to km/s', () => {
    expect(formatProbeSpeed(17 * KM_PC)).toBe('17.00 km/s');
  });
});

describe('formatProbeLaunch', () => {
  it('keeps the date part of the roster launch instant', () => {
    expect(formatProbeLaunch('1977-09-05T12:56:00Z')).toBe('1977-09-05');
  });
});

describe('formatProbeSignal', () => {
  it('reads Active while transmitting', () => {
    expect(formatProbeSignal(false, null)).toBe('Active');
  });

  // Scrubbing back before last contact un-loses the signal: the state is a
  // function of the model clock, not of which probe it is.
  it('reads Active for a lost probe at an epoch before its last contact', () => {
    expect(formatProbeSignal(false, Date.UTC(2003, 0, 23) / 1000)).toBe('Active');
  });

  it('dates the loss once the clock has passed it', () => {
    expect(formatProbeSignal(true, Date.UTC(2003, 0, 23) / 1000)).toBe('Lost 2003-01-23');
  });
});
