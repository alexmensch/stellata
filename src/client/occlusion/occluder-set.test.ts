import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OccluderSet } from './occluder-set';
import { AU_PC, KM_PC } from '../util/astronomy-constants';

const EARTH_R = 6371 * KM_PC;
const MOON_A = 384400 * KM_PC;

const camera = new THREE.Vector3(-0.01 * AU_PC, 0, 0);
const behind = new THREE.Vector3(MOON_A, 0, 0);
const aside = new THREE.Vector3(MOON_A, MOON_A, 0);

describe('OccluderSet', () => {
  it('answers false with nothing published', () => {
    const set = new OccluderSet();
    expect(set.hides(behind, camera)).toBe(false);
    expect(set.count).toBe(0);
  });

  it('hides an anchor behind any one published body', () => {
    const set = new OccluderSet();
    set.addSphere(0, 0, 0, EARTH_R);
    expect(set.hides(behind, camera)).toBe(true);
    expect(set.hides(aside, camera)).toBe(false);
  });

  it('scans every entry, not just the first', () => {
    const set = new OccluderSet();
    set.addSphere(0, MOON_A, 0, EARTH_R);
    set.addSphere(0, 0, 0, EARTH_R);
    expect(set.count).toBe(2);
    expect(set.hides(behind, camera)).toBe(true);
  });

  it('beginFrame drops the previous frame entirely', () => {
    const set = new OccluderSet();
    set.addSphere(0, 0, 0, EARTH_R);
    set.beginFrame();
    expect(set.count).toBe(0);
    expect(set.hides(behind, camera)).toBe(false);
  });

  it('reuses its backing arrays across frames', () => {
    const set = new OccluderSet();
    for (let frame = 0; frame < 3; frame++) {
      set.beginFrame();
      set.addSphere(0, 0, 0, EARTH_R);
      set.addSphere(0, MOON_A, 0, EARTH_R);
      expect(set.count).toBe(2);
      expect(set.hides(behind, camera)).toBe(true);
    }
  });
});

// Saturn's flattening, the worst in the model, at the planet-focus zoom
// floor (~2.4 equatorial radii). The camera sits at the origin looking down
// −z at the body; the pole is +y.
//
// What a mask covers is an ANGLE off the body-centre direction, not a
// distance at the body's own depth — the cone widens with range, so an
// anchor's offset in body radii says nothing on its own. Toward the pole
// the drawn limb closes to ~0.393 rad against ~0.430 across it; a round
// mask claims the equatorial figure in both directions and blanks the 2°
// of open sky between them.
const SAT_R = 60268 * KM_PC;
const SAT_RATIO = 1 - 0.09796;
const POLE_Y = { x: 0, y: 1, z: 0 };
const SAT_D = 2.4 * SAT_R;
const satCam = new THREE.Vector3(0, 0, 0);
const satBody = { x: 0, y: 0, z: -SAT_D };

/** An anchor well beyond the body, `theta` radians off its centre
 *  direction — toward the pole (+y) or across it (+x). */
function anchorAt(theta: number, axis: 'pole' | 'across'): THREE.Vector3 {
  const L = 100 * SAT_R;
  const off = L * Math.sin(theta);
  return new THREE.Vector3(
    axis === 'across' ? off : 0,
    axis === 'pole' ? off : 0,
    -L * Math.cos(theta),
  );
}

const flatSet = (): OccluderSet => {
  const s = new OccluderSet();
  s.addSpheroid(satBody.x, satBody.y, satBody.z, SAT_R, SAT_RATIO, POLE_Y);
  return s;
};
const roundSet = (): OccluderSet => {
  const s = new OccluderSet();
  s.addSphere(satBody.x, satBody.y, satBody.z, SAT_R);
  return s;
};

describe('OccluderSet — a flattened body masks its own drawn limb', () => {
  it('hides an anchor squarely behind the body', () => {
    expect(flatSet().hides(anchorAt(0, 'pole'), satCam)).toBe(true);
  });

  it('clears the band between the polar limb and the equatorial one', () => {
    // 0.41 rad is outside the drawn polar limb and inside the equatorial
    // one — open sky that only a round mask blanks.
    expect(flatSet().hides(anchorAt(0.41, 'pole'), satCam)).toBe(false);
    expect(roundSet().hides(anchorAt(0.41, 'pole'), satCam)).toBe(true);
  });

  it('masks across the pole exactly as a sphere does', () => {
    // That axis is the equator either way, so the two must agree on it.
    for (const theta of [0.2, 0.41, 0.42, 0.45, 0.6]) {
      expect(flatSet().hides(anchorAt(theta, 'across'), satCam))
        .toBe(roundSet().hides(anchorAt(theta, 'across'), satCam));
    }
  });

  it('still hides well inside the polar limb, and clears well outside it', () => {
    expect(flatSet().hides(anchorAt(0.3, 'pole'), satCam)).toBe(true);
    expect(flatSet().hides(anchorAt(0.6, 'pole'), satCam)).toBe(false);
  });

  it('never hides the body its own anchor sits at, squashed or not', () => {
    expect(flatSet().hides(new THREE.Vector3(0, 0, -SAT_D), satCam)).toBe(false);
  });

  it('addSphere is addSpheroid at ratio 1', () => {
    const explicit = new OccluderSet();
    explicit.addSpheroid(satBody.x, satBody.y, satBody.z, SAT_R, 1, POLE_Y);
    for (const theta of [0, 0.3, 0.41, 0.45, 0.6]) {
      expect(roundSet().hides(anchorAt(theta, 'pole'), satCam))
        .toBe(explicit.hides(anchorAt(theta, 'pole'), satCam));
    }
  });
});
