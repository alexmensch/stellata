import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  autoFrameFor,
  ballBasisInto,
  buildReferenceFrames,
  captureReferenceFrame,
  frameDirToBallInto,
  FRAME_CYCLE,
  nextFrameKey,
  POLE_HOLD_DEG,
  readAttitude,
  type Attitude,
  type FocusFrameInputs,
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

describe('ballBasisInto — the 8-ball moves the way a pilot expects', () => {
  const frame = frames.equatorial;

  function ballScreenPos(camera: THREE.Camera, dir: THREE.Vector3) {
    const m = ballBasisInto(new THREE.Matrix4(), camera, frame);
    const inBall = frameDirToBallInto(new THREE.Vector3(), dir, frame);
    return inBall.applyMatrix4(m);
  }

  function levelCameraAt(lonDeg: number, latDeg: number) {
    const lon = lonDeg * DEG;
    const lat = latDeg * DEG;
    const dir = new THREE.Vector3(
      Math.cos(lat) * Math.cos(lon),
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
    );
    return { camera: cameraLookingAt(dir), dir };
  }

  function turn(camera: THREE.Camera, localAxis: THREE.Vector3, deg: number) {
    const axis = localAxis.clone().applyQuaternion(camera.quaternion);
    camera.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(axis, deg * DEG),
    );
  }

  it('puts the boresight at the centre of the visible face', () => {
    const { camera, dir } = levelCameraAt(37, -22);
    const p = ballScreenPos(camera, dir);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(1, 10);
  });

  it('keeps the frame pole upright when the camera is level', () => {
    const { camera } = levelCameraAt(0, 0);
    const p = ballScreenPos(camera, frame.pole);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(1, 10);
  });

  it('is a reflection, not a rotation', () => {
    const { camera } = levelCameraAt(17, 5);
    expect(ballBasisInto(new THREE.Matrix4(), camera, frame).determinant()).toBeCloseTo(
      -1,
      10,
    );
  });

  it('pitching up drives the old centre down the ball', () => {
    const { camera, dir } = levelCameraAt(0, 0);
    turn(camera, new THREE.Vector3(1, 0, 0), 20);
    const p = ballScreenPos(camera, dir);
    expect(p.y).toBeLessThan(-0.3);
    expect(p.x).toBeCloseTo(0, 10);
  });

  it('yawing right drives the old centre left across the ball', () => {
    const { camera, dir } = levelCameraAt(0, 0);
    turn(camera, new THREE.Vector3(0, 1, 0), -20);
    const p = ballScreenPos(camera, dir);
    expect(p.x).toBeLessThan(-0.3);
    expect(p.y).toBeCloseTo(0, 10);
  });

  it('banking right tips the pole left, by the bank angle', () => {
    const { camera } = levelCameraAt(0, 0);
    turn(camera, new THREE.Vector3(0, 0, -1), 30);
    const p = ballScreenPos(camera, frame.pole);
    expect(p.x).toBeCloseTo(-Math.sin(30 * DEG), 6);
    expect(p.y).toBeCloseTo(Math.cos(30 * DEG), 6);
    expect(read(camera, 'equatorial').bankRad / DEG).toBeCloseTo(-30, 6);
  });

  it('places increasing longitude to the left, as the real sky does', () => {
    const { camera } = levelCameraAt(0, 0);
    const east = new THREE.Vector3()
      .copy(frame.zeroLon)
      .multiplyScalar(Math.cos(5 * DEG))
      .addScaledVector(frame.east, Math.sin(5 * DEG));
    expect(ballScreenPos(camera, east).x).toBeLessThan(0);
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

describe('nextFrameKey', () => {
  it('advances through the cycle, ignoring the focus default', () => {
    expect(nextFrameKey('equatorial', 'galactic', false)).toBe('ecliptic');
    expect(nextFrameKey('ecliptic', 'galactic', false)).toBe('galactic');
    expect(nextFrameKey('galactic', 'galactic', false)).toBe('equatorial');
  });

  it('leaves a captured REF on the focused object\'s own default', () => {
    expect(nextFrameKey('reference', 'ecliptic', false)).toBe('ecliptic');
    expect(nextFrameKey('reference', 'galactic', false)).toBe('galactic');
    expect(nextFrameKey('reference', 'equatorial', false)).toBe('equatorial');
    // Available or not, a captured datum has no successor of its own.
    expect(nextFrameKey('reference', 'ecliptic', true)).toBe('ecliptic');
  });

  it('reaches every frame from every frame', () => {
    for (const start of ['equatorial', 'ecliptic', 'galactic'] as const) {
      const seen = new Set<string>();
      let at: ReturnType<typeof nextFrameKey> = start;
      for (let i = 0; i < 3; i++) {
        at = nextFrameKey(at, 'galactic', false);
        seen.add(at);
      }
      expect(seen.size).toBe(3);
    }
  });

  it('runs ORB - EQU - ECL - GAL when the focus rides an orbit', () => {
    expect(nextFrameKey('orbit', 'galactic', true)).toBe('equatorial');
    expect(nextFrameKey('equatorial', 'galactic', true)).toBe('ecliptic');
    expect(nextFrameKey('ecliptic', 'galactic', true)).toBe('galactic');
    expect(nextFrameKey('galactic', 'galactic', true)).toBe('orbit');
  });

  it('skips ORB when the focused object rides no orbit', () => {
    expect(nextFrameKey('galactic', 'galactic', false)).toBe('equatorial');
  });

  it('leaves ORB for the cycle even once the orbit is gone', () => {
    // A captured ORB survives a focus change that strips the elements out
    // from under it; the flag must still have somewhere to go.
    expect(nextFrameKey('orbit', 'galactic', false)).toBe('equatorial');
  });

  it('reaches all four from every frame while an orbit is on offer', () => {
    for (const start of FRAME_CYCLE) {
      const seen = new Set<string>();
      let at: ReturnType<typeof nextFrameKey> = start;
      for (let i = 0; i < FRAME_CYCLE.length; i++) {
        at = nextFrameKey(at, 'galactic', true);
        seen.add(at);
      }
      expect(seen.size).toBe(FRAME_CYCLE.length);
    }
  });

  it('never answers ORB when no orbit is on offer', () => {
    for (const start of FRAME_CYCLE) {
      let at: ReturnType<typeof nextFrameKey> = start;
      for (let i = 0; i < 8; i++) {
        at = nextFrameKey(at, 'galactic', false);
        expect(at).not.toBe('orbit');
      }
    }
  });
});

describe('autoFrameFor', () => {
  const focus = (o: Partial<FocusFrameInputs> = {}): FocusFrameInputs => ({
    kind: null,
    planetName: null,
    isSol: false,
    ...o,
  });

  it('reads an empty sky as galactic', () => {
    expect(autoFrameFor(focus())).toBe('galactic');
  });

  it('rides the ecliptic across Sol\'s system', () => {
    expect(autoFrameFor(focus({ kind: 'planet', planetName: 'Mars' }))).toBe('ecliptic');
    expect(autoFrameFor(focus({ kind: 'planet', planetName: 'Luna' }))).toBe('ecliptic');
    expect(autoFrameFor(focus({ kind: 'probe' }))).toBe('ecliptic');
    expect(autoFrameFor(focus({ kind: 'star', isSol: true }))).toBe('ecliptic');
  });

  it('puts Earth alone on the celestial equator', () => {
    expect(autoFrameFor(focus({ kind: 'planet', planetName: 'Earth' }))).toBe('equatorial');
  });

  it('falls back to ecliptic for a planet whose name never resolved', () => {
    expect(autoFrameFor(focus({ kind: 'planet', planetName: null }))).toBe('ecliptic');
  });

  it('leaves the system on galactic', () => {
    expect(autoFrameFor(focus({ kind: 'star' }))).toBe('galactic');
    for (const kind of ['cloud', 'lg', 'shell'] as const) {
      expect(autoFrameFor(focus({ kind }))).toBe('galactic');
    }
  });
});

describe('captureReferenceFrame', () => {
  it('reads dead level and zero from the attitude it was captured at', () => {
    const camera = cameraLookingAt(new THREE.Vector3(0.3, -0.8, 0.5));
    camera.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
        41 * DEG,
      ),
    );
    const out: Attitude = { pitchRad: 9, bankRad: 9, lonRad: 9, sinFromPole: 0 };
    readAttitude(camera, captureReferenceFrame(camera), out);
    expect(out.pitchRad).toBeCloseTo(0, 10);
    expect(out.lonRad).toBeCloseTo(0, 10);
    expect(out.bankRad).toBeCloseTo(0, 10);
  });

  it('captures an orthonormal frame like any other', () => {
    const frame = captureReferenceFrame(cameraLookingAt(new THREE.Vector3(1, 2, -3)));
    expect(frame.key).toBe('reference');
    expect(frame.pole.length()).toBeCloseTo(1, 12);
    expect(frame.zeroLon.length()).toBeCloseTo(1, 12);
    expect(frame.east.length()).toBeCloseTo(1, 12);
    expect(frame.pole.dot(frame.zeroLon)).toBeCloseTo(0, 12);
  });
});
