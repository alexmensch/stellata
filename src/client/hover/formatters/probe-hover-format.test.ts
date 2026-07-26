import { describe, expect, it, beforeEach } from 'vitest';
import { AU_PC, KM_PC } from '../../util/astronomy-constants';
import { setUnit } from '../../ui/distance-util';
import { formatProbeHover, type ProbeHoverFormatContext } from './probe-hover-format';

const LIVE: ProbeHoverFormatContext = {
  label: 'Voyager 1',
  cameraDistancePc: 10 * KM_PC,
  solDistancePc: 167 * AU_PC,
  speedPcPerSec: 16.95 * KM_PC,
  signalLost: false,
  lastContactT: null,
};

describe('formatProbeHover', () => {
  beforeEach(() => setUnit('pc'));

  it('leads with camera distance, then the Sol-relative mission stats', () => {
    const p = formatProbeHover(LIVE);
    expect(p.name).toBe('Voyager 1');
    expect(p.lines[1]).toBe('From Sol 167.0 AU (23.1 lt-hr)');
    expect(p.lines[2]).toBe('Speed 16.95 km/s');
  });

  it('omits the signal line while the probe still transmits', () => {
    expect(formatProbeHover(LIVE).lines).toHaveLength(3);
  });

  it('adds a dated signal line once the clock has passed last contact', () => {
    const p = formatProbeHover({
      ...LIVE,
      label: 'Pioneer 10',
      signalLost: true,
      lastContactT: Date.UTC(2003, 0, 23) / 1000,
    });
    expect(p.lines[3]).toBe('Signal Lost 2003-Jan-23');
  });
});
