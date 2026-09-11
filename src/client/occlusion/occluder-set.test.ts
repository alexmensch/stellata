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
    set.add(0, 0, 0, EARTH_R);
    expect(set.hides(behind, camera)).toBe(true);
    expect(set.hides(aside, camera)).toBe(false);
  });

  it('scans every entry, not just the first', () => {
    const set = new OccluderSet();
    set.add(0, MOON_A, 0, EARTH_R);
    set.add(0, 0, 0, EARTH_R);
    expect(set.count).toBe(2);
    expect(set.hides(behind, camera)).toBe(true);
  });

  it('beginFrame drops the previous frame entirely', () => {
    const set = new OccluderSet();
    set.add(0, 0, 0, EARTH_R);
    set.beginFrame();
    expect(set.count).toBe(0);
    expect(set.hides(behind, camera)).toBe(false);
  });

  it('reuses its backing arrays across frames', () => {
    const set = new OccluderSet();
    for (let frame = 0; frame < 3; frame++) {
      set.beginFrame();
      set.add(0, 0, 0, EARTH_R);
      set.add(0, MOON_A, 0, EARTH_R);
      expect(set.count).toBe(2);
      expect(set.hides(behind, camera)).toBe(true);
    }
  });
});
