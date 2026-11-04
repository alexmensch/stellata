import { describe, it, expect } from 'vitest';

import { PROBE_MISSIONS } from './probe-roster';
import { isProbePublicAsset, probeTrajectoryFilename } from './sync-probes-pure';

describe('isProbePublicAsset', () => {
  it('ships every roster trajectory', () => {
    for (const probe of PROBE_MISSIONS) {
      expect(isProbePublicAsset(probeTrajectoryFilename(probe.id))).toBe(true);
    }
  });

  it('keeps folder docs and strays out of the bundle', () => {
    for (const name of ['README.md', 'cassini.json', 'voyager1.json.bak', 'voyager1']) {
      expect(isProbePublicAsset(name)).toBe(false);
    }
  });
});

describe('PROBE_MISSIONS', () => {
  it('covers the five Sun-escape probes with unique ids', () => {
    expect(PROBE_MISSIONS).toHaveLength(5);
    expect(new Set(PROBE_MISSIONS.map((p) => p.id)).size).toBe(5);
    expect(new Set(PROBE_MISSIONS.map((p) => p.horizonsId)).size).toBe(5);
  });

  it('launches before the ephemeris starts and loses contact after launch', () => {
    for (const probe of PROBE_MISSIONS) {
      const launch = Date.parse(probe.launchUtc);
      expect(Number.isFinite(launch)).toBe(true);
      expect(launch).toBeLessThanOrEqual(Date.parse(probe.ephemerisStart));
      if (probe.lastContactUtc !== null) {
        expect(Date.parse(probe.lastContactUtc)).toBeGreaterThan(launch);
      }
    }
  });

  it('marks exactly the two Pioneers as signal-lost', () => {
    const lost = PROBE_MISSIONS.filter((p) => p.lastContactUtc !== null).map((p) => p.id);
    expect(lost).toEqual(['pioneer10', 'pioneer11']);
  });
});
