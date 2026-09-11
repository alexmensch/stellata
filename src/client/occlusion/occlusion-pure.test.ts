import { describe, it, expect } from 'vitest';
import { sphereHidesPoint } from './occlusion-pure';
import { AU_PC, KM_PC, R_SUN_PC } from '../util/astronomy-constants';

const EARTH_R = 6371 * KM_PC;

const MOON_A = 384400 * KM_PC;

/** Camera on −x at `dAu`, Earth at the origin, the Moon offset along
 *  +x (behind Earth) or −x (in front of it). */
function moonVerdict(dAu: number, moonX: number): boolean {
  return sphereHidesPoint(
    -dAu * AU_PC, 0, 0,
    moonX, 0, 0,
    0, 0, 0,
    EARTH_R,
  );
}

describe('sphereHidesPoint — the Moon behind Earth', () => {
  it('hides an anchor directly behind the occluder', () => {
    expect(moonVerdict(0.01, MOON_A)).toBe(true);
  });

  it('leaves an anchor in front of the occluder alone', () => {
    expect(moonVerdict(0.01, -MOON_A)).toBe(false);
  });

  it('leaves an anchor clear of the limb alone', () => {
    // One lunar orbit sideways at that range is ~57° off the Earth
    // disc's ~0.24° angular radius.
    expect(sphereHidesPoint(
      -0.01 * AU_PC, 0, 0,
      MOON_A, MOON_A, 0,
      0, 0, 0,
      EARTH_R,
    )).toBe(false);
  });

  it('is camera-anywhere: the same pair reads clear from the side', () => {
    expect(sphereHidesPoint(
      0, -0.01 * AU_PC, 0,
      MOON_A, 0, 0,
      0, 0, 0,
      EARTH_R,
    )).toBe(false);
  });
});

describe('sphereHidesPoint — self-occlusion', () => {
  it('never hides an anchor at the occluder centre', () => {
    expect(sphereHidesPoint(
      -0.01 * AU_PC, 0, 0,
      0, 0, 0,
      0, 0, 0,
      EARTH_R,
    )).toBe(false);
  });

  it('never hides an anchor short of the far surface', () => {
    expect(moonVerdict(0.01, EARTH_R * 0.999)).toBe(false);
    expect(moonVerdict(0.01, EARTH_R * 1.001)).toBe(true);
  });
});

describe('sphereHidesPoint — degenerate inputs', () => {
  it('returns false for a zero or negative radius', () => {
    expect(moonVerdictWithRadius(0)).toBe(false);
    expect(moonVerdictWithRadius(-EARTH_R)).toBe(false);
  });

  it('returns false with the camera at or inside the surface', () => {
    expect(sphereHidesPoint(
      -EARTH_R, 0, 0,
      MOON_A, 0, 0,
      0, 0, 0,
      EARTH_R,
    )).toBe(false);
  });

  function moonVerdictWithRadius(radiusPc: number): boolean {
    return sphereHidesPoint(
      -0.01 * AU_PC, 0, 0,
      MOON_A, 0, 0,
      0, 0, 0,
      radiusPc,
    );
  }
});

describe('sphereHidesPoint — a distant label behind a near body', () => {
  const CLOUD_PC = 150;

  it('hides a molecular-cloud anchor behind a planet disc', () => {
    // Camera 5 AU out on −x, Jupiter at the origin, the cloud 150 pc
    // beyond it on the same ray.
    expect(sphereHidesPoint(
      -5 * AU_PC, 0, 0,
      CLOUD_PC, 0, 0,
      0, 0, 0,
      71492 * KM_PC,
    )).toBe(true);
  });

  it('hides a cloud anchor behind the host star disc', () => {
    expect(sphereHidesPoint(
      -5 * AU_PC, 0, 0,
      CLOUD_PC, 0, 0,
      0, 0, 0,
      R_SUN_PC,
    )).toBe(true);
  });

  it('leaves a cloud anchor one solar radius off the limb alone', () => {
    // Sol's disc is ~0.1° across from 5 AU; 2 R_sun sideways at 150 pc
    // is far outside it.
    expect(sphereHidesPoint(
      -5 * AU_PC, 0, 0,
      CLOUD_PC, CLOUD_PC * 0.01, 0,
      0, 0, 0,
      R_SUN_PC,
    )).toBe(false);
  });
});

describe('sphereHidesPoint — the limb is the true angular radius', () => {
  // At the planet-focus park floor the camera sits a few body radii
  // out, where asin(r/d) and the small-angle r/d diverge: at d = 2.4r
  // the true half-angle is 24.6°, the small-angle form 23.9°. An anchor
  // in that gap is behind the body and must read occluded.
  const R = 6371 * KM_PC;
  const d = 2.4 * R;

  it('hides an anchor between the small-angle and true limb', () => {
    const theta = 0.5 * (Math.asin(1 / 2.4) + 1 / 2.4);
    const far = 100 * R;
    expect(sphereHidesPoint(
      -d, 0, 0,
      far * Math.cos(theta) - d, far * Math.sin(theta), 0,
      0, 0, 0,
      R,
    )).toBe(true);
  });

  it('leaves an anchor outside the true limb alone', () => {
    const theta = Math.asin(1 / 2.4) * 1.05;
    const far = 100 * R;
    expect(sphereHidesPoint(
      -d, 0, 0,
      far * Math.cos(theta) - d, far * Math.sin(theta), 0,
      0, 0, 0,
      R,
    )).toBe(false);
  });
});
