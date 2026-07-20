import { beforeEach, describe, expect, it } from 'vitest';
import type { Cloud } from '../../molecular-clouds/cloud-loader';
import { makeMockCloud } from '../../molecular-clouds/cloud-mock';
import { setUnit } from '../../ui/distance-util';
import {
  formatCloudHover,
  type CloudHoverFormatContext,
} from './cloud-hover-format';

// Build a synthetic Cloud fixture. Only the fields the formatter reads
// (name, axes) matter; the hover distance is the camera distance passed
// per pick. The fixture values match real entries in the
// public/clouds.json catalog so the goldens reflect the actual hover
// strings a user would see.
function cloud(
  name: string,
  axes: [number, number, number],
  distancePc: number,
  source: 'Z2020' | 'Z2021T1' = 'Z2021T1',
): Cloud {
  return makeMockCloud({
    name,
    id: name.toLowerCase().replace(/\s+/g, '-'),
    axes,
    source,
    distanceFromSol: distancePc,
  });
}

function buildCtx(clouds: Cloud[]): CloudHoverFormatContext {
  return { clouds };
}

describe('formatCloudHover', () => {
  beforeEach(() => {
    // fmtDist / fmtDistAuto read the module-level unit toggle. Pin to pc
    // so the golden strings stay stable regardless of test-runner order.
    setUnit('pc');
  });

  it('formats Taurus (Z2021T1 ellipsoid, near-by molecular cloud)', () => {
    // Taurus from public/clouds.json: camera parked at its Sol distance
    // of 150.4 pc, axes
    // [22.0, 19.0, 9.5] pc. major=22, minor=9.5, both in fmtDist's
    // one-decimal tier (≥ 1 pc, < 100 pc).
    const out = formatCloudHover(0, 150.4, buildCtx([
      cloud('Taurus', [22.0, 19.0, 9.5], 150.4),
    ]));
    expect(out.name).toBe('Taurus');
    expect(out.lines).toEqual([
      '150 pc',
      'Size 22.0 × 9.5 pc',
    ]);
  });

  it('formats Orion A (Z2021T1 ellipsoid, ~414 pc)', () => {
    // Orion A from public/clouds.json: distance 414.4 pc, axes
    // [17.0, 32.0, 15.5] pc. major=32, minor=15.5; the longest axis is
    // the second of the three, exercising the Math.max/min path
    // (vs Taurus where axes[0] is the longest).
    const out = formatCloudHover(0, 414.4, buildCtx([
      cloud('Orion A', [17.0, 32.0, 15.5], 414.4),
    ]));
    expect(out.name).toBe('Orion A');
    expect(out.lines).toEqual([
      '414 pc',
      'Size 32.0 × 15.5 pc',
    ]);
  });

  it('formats a Z2020 sphere cloud (equal semi-axes collapse cleanly)', () => {
    // Aquila Rift from public/clouds.json: distance 236.2 pc, axes
    // [75.73, 75.73, 75.73] pc (sphere — Z2020 source has no orientation
    // fit). major=minor=75.73 → "75.7 × 75.7 pc" after one-decimal
    // rounding; the size line still reads naturally.
    const out = formatCloudHover(0, 236.2, buildCtx([
      cloud('Aquila Rift', [75.73, 75.73, 75.73], 236.2, 'Z2020'),
    ]));
    expect(out.name).toBe('Aquila Rift');
    expect(out.lines).toEqual([
      '236 pc',
      'Size 75.7 × 75.7 pc',
    ]);
  });

  it('returns empty payload for out-of-range index', () => {
    const out = formatCloudHover(99, 100, buildCtx([]));
    expect(out).toEqual({ name: '', lines: [] });
  });
});
