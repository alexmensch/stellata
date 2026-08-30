import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildReferenceFrames,
  POLE_HOLD_DEG,
  readAttitude,
  type Attitude,
} from './attitude-pure';

const DEG = Math.PI / 180;
const frames = buildReferenceFrames();

function cameraLookingAt(dir: THREE.Vector3, up = new THREE.Vector3(0, 0, 1)) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 0);
  camera.up.copy(up);
  camera.lookAt(dir);
  return camera;
}

function read(camera: THREE.Camera, key: 'equatorial' | 'ecliptic' | 'galactic') {
  const out: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
  return readAttitude(camera, frames[key], out);
}

describe('readAttitude — equatorial', () => {
  it('reads the boresight as RA/Dec', () => {
    const dec = 30 * DEG;
    const ra = 90 * DEG;
    const dir = new THREE.Vector3(
      Math.cos(dec) * Math.cos(ra),
      Math.cos(dec) * Math.sin(ra),
      Math.sin(dec),
    );
    const a = read(cameraLookingAt(dir), 'equatorial');
    expect(a.pitchRad / DEG).toBeCloseTo(30, 6);
    expect(a.lonRad / DEG).toBeCloseTo(90, 6);
    expect(a.bankRad / DEG).toBeCloseTo(0, 6);
  });

  it('is level when the camera up is the north celestial pole', () => {
    const a = read(cameraLookingAt(new THREE.Vector3(1, 0, 0)), 'equatorial');
    expect(a.bankRad).toBeCloseTo(0, 12);
    expect(a.sinFromPole).toBeCloseTo(1, 12);
  });

  it('reports a right bank as a negative bank angle', () => {
    const camera = cameraLookingAt(new THREE.Vector3(1, 0, 0));
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(forward, 30 * DEG),
    );
    const a = read(camera, 'equatorial');
    expect(a.bankRad / DEG).toBeCloseTo(-30, 6);
    expect(a.pitchRad).toBeCloseTo(0, 10);
  });

  it('holds the last bank on the pole, where no level up exists', () => {
    const camera = cameraLookingAt(new THREE.Vector3(1, 0, 0));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const out: Attitude = { pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 };
    readAttitude(camera, frames.equatorial, out);
    out.bankRad = 1.234;

    camera.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(right, 90 * DEG),
    );
    readAttitude(camera, frames.equatorial, out);

    // asin is ill-conditioned at ±1, so a boresight a float step off the pole
    // reads a microdegree short of 90 — well inside the hold cone either way.
    expect(out.pitchRad / DEG).toBeCloseTo(90, 4);
    expect(out.sinFromPole).toBeLessThan(1e-6);
    expect(out.bankRad).toBe(1.234);
  });

  it('resumes measuring bank once clear of the hold cone', () => {
    const camera = cameraLookingAt(new THREE.Vector3(1, 0, 0));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    camera.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(right, (90 - POLE_HOLD_DEG * 3) * DEG),
    );
    const out: Attitude = { pitchRad: 0, bankRad: 9, lonRad: 0, sinFromPole: 1 };
    readAttitude(camera, frames.equatorial, out);
    expect(out.bankRad).not.toBe(9);
    expect(out.bankRad / DEG).toBeCloseTo(0, 6);
  });
});

describe('reference frames', () => {
  it('tilts the ecliptic pole from the celestial pole by the obliquity', () => {
    const tilt = frames.ecliptic.pole.angleTo(frames.equatorial.pole) / DEG;
    expect(tilt).toBeCloseTo(23.4392911, 6);
  });

  it('puts the ecliptic pole at RA 18h', () => {
    const p = frames.ecliptic.pole;
    const ra = ((Math.atan2(p.y, p.x) * 12) / Math.PI + 24) % 24;
    expect(ra).toBeCloseTo(18, 6);
  });

  it('separates the galactic and celestial poles by about 63 degrees', () => {
    const sep = frames.galactic.pole.angleTo(frames.equatorial.pole) / DEG;
    expect(sep).toBeGreaterThan(62);
    expect(sep).toBeLessThan(64);
  });

  it('reads the galactic centre as l = 0, b = 0', () => {
    const camera = cameraLookingAt(frames.galactic.zeroLon.clone());
    const a = read(camera, 'galactic');
    expect(a.lonRad / DEG).toBeCloseTo(0, 6);
    expect(a.pitchRad / DEG).toBeCloseTo(0, 6);
  });

  it('keeps every frame basis orthonormal', () => {
    for (const frame of Object.values(frames)) {
      expect(frame.pole.length()).toBeCloseTo(1, 12);
      expect(frame.zeroLon.length()).toBeCloseTo(1, 12);
      expect(frame.east.length()).toBeCloseTo(1, 12);
      expect(frame.pole.dot(frame.zeroLon)).toBeCloseTo(0, 12);
      expect(frame.east.dot(frame.zeroLon)).toBeCloseTo(0, 12);
    }
  });
});
