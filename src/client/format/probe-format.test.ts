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
  // A numeric month reads day-first or day-last depending on the reader's
  // convention; the 3-letter name can't be misread either way.
  it('names the month between ISO year and day', () => {
    expect(formatProbeLaunch('1977-09-05T12:56:00Z')).toBe('1977-Sep-05');
    expect(formatProbeLaunch('1977-08-20T14:29:00Z')).toBe('1977-Aug-20');
  });

  it('reads the launch instant in UTC, not the runner\'s zone', () => {
    // 1972-03-03T01:49Z is still 1972-03-02 in the Americas — a local-zone
    // read would date Pioneer 10's launch a day early west of Greenwich.
    expect(formatProbeLaunch('1972-03-03T01:49:00Z')).toBe('1972-Mar-03');
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
    expect(formatProbeSignal(true, Date.UTC(2003, 0, 23) / 1000)).toBe('Lost 2003-Jan-23');
  });
});
