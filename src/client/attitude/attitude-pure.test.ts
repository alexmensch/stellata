import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  autoFrameFor,
  ballBasisInto,
  buildReferenceFrames,
  captureReferenceFrame,
  captureTargetFrame,
  frameAfterFocusChange,
  frameAvailableFor,
  frameDirToBallInto,
  FRAME_CYCLE,
  nextFrameKey,
  orbitLockShowing,
  POLE_HOLD_DEG,
  readAttitude,
  type Attitude,
  type AutoFrameKey,
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
  const anywhere = () => true;
  // Away from Sol's system the sky frames collapse to the one still defined by
  // something real, which is what makes the walk's termination non-trivial.
  const galacticOnly = (frame: AutoFrameKey) => frame === 'galactic';

  it('advances through the cycle, ignoring the focus default', () => {
    expect(nextFrameKey('galactic', 'ecliptic', false, anywhere)).toBe('ecliptic');
    expect(nextFrameKey('ecliptic', 'galactic', false, anywhere)).toBe('equatorial');
    expect(nextFrameKey('equatorial', 'ecliptic', false, anywhere)).toBe('galactic');
  });

  it('leaves a captured REF on the focused object\'s own default', () => {
    expect(nextFrameKey('reference', 'ecliptic', false, anywhere)).toBe('ecliptic');
    expect(nextFrameKey('reference', 'galactic', false, anywhere)).toBe('galactic');
    expect(nextFrameKey('reference', 'equatorial', false, anywhere)).toBe('equatorial');
    // Available or not, a captured datum has no successor of its own.
    expect(nextFrameKey('reference', 'ecliptic', true, anywhere)).toBe('ecliptic');
  });

  it('reaches every frame from every frame', () => {
    for (const start of ['equatorial', 'ecliptic', 'galactic'] as const) {
      const seen = new Set<string>();
      let at: ReturnType<typeof nextFrameKey> = start;
      for (let i = 0; i < 3; i++) {
        at = nextFrameKey(at, 'galactic', false, anywhere);
        seen.add(at);
      }
      expect(seen.size).toBe(3);
    }
  });

  it('runs ORB - GAL - ECL - EQU when the focus rides an orbit', () => {
    expect(nextFrameKey('orbit', 'galactic', true, anywhere)).toBe('galactic');
    expect(nextFrameKey('galactic', 'galactic', true, anywhere)).toBe('ecliptic');
    expect(nextFrameKey('ecliptic', 'galactic', true, anywhere)).toBe('equatorial');
    expect(nextFrameKey('equatorial', 'galactic', true, anywhere)).toBe('orbit');
  });

  it('skips ORB when the focused object rides no orbit', () => {
    expect(nextFrameKey('equatorial', 'galactic', false, anywhere)).toBe('galactic');
  });

  it('leaves ORB for the cycle even once the orbit is gone', () => {
    // A captured ORB survives a focus change that strips the elements out
    // from under it; the flag must still have somewhere to go.
    expect(nextFrameKey('orbit', 'galactic', false, anywhere)).toBe('galactic');
  });

  it('reaches all four from every frame while an orbit is on offer', () => {
    for (const start of FRAME_CYCLE) {
      const seen = new Set<string>();
      let at: ReturnType<typeof nextFrameKey> = start;
      for (let i = 0; i < FRAME_CYCLE.length; i++) {
        at = nextFrameKey(at, 'galactic', true, anywhere);
        seen.add(at);
      }
      expect(seen.size).toBe(FRAME_CYCLE.length);
    }
  });

  it('never answers ORB when no orbit is on offer', () => {
    for (const start of FRAME_CYCLE) {
      let at: ReturnType<typeof nextFrameKey> = start;
      for (let i = 0; i < 8; i++) {
        at = nextFrameKey(at, 'galactic', false, anywhere);
        expect(at).not.toBe('orbit');
      }
    }
  });

  it('skips a frame the focused object gives no meaning to', () => {
    expect(nextFrameKey('galactic', 'galactic', false, galacticOnly)).toBe('galactic');
    expect(nextFrameKey('ecliptic', 'galactic', false, galacticOnly)).toBe('galactic');
  });

  // Galactic is available everywhere, so the walk can never run off the end —
  // but ORB plus one sky frame is the narrowest the cycle ever gets.
  it('still alternates with ORB when only one sky frame is available', () => {
    expect(nextFrameKey('galactic', 'galactic', true, galacticOnly)).toBe('orbit');
    expect(nextFrameKey('orbit', 'galactic', true, galacticOnly)).toBe('galactic');
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

describe('frameAvailableFor', () => {
  const focus = (o: Partial<FocusFrameInputs> = {}): FocusFrameInputs => ({
    kind: null, planetName: null, isSol: false, ...o,
  });
  const earth = focus({ kind: 'planet', planetName: 'Earth' });
  const jupiter = focus({ kind: 'planet', planetName: 'Jupiter' });
  const algol = focus({ kind: 'star' });

  it('offers galactic from anywhere — the disc is real wherever you stand', () => {
    for (const f of [earth, jupiter, algol, focus()]) {
      expect(frameAvailableFor('galactic', f)).toBe(true);
    }
  });

  it('offers the ecliptic across Sol\'s system and nowhere else', () => {
    expect(frameAvailableFor('ecliptic', earth)).toBe(true);
    expect(frameAvailableFor('ecliptic', jupiter)).toBe(true);
    expect(frameAvailableFor('ecliptic', focus({ kind: 'probe' }))).toBe(true);
    expect(frameAvailableFor('ecliptic', focus({ kind: 'star', isSol: true }))).toBe(true);
    expect(frameAvailableFor('ecliptic', algol)).toBe(false);
    expect(frameAvailableFor('ecliptic', focus())).toBe(false);
  });

  // RA/Dec is measured off Earth's own axis and equinox, so it is that one
  // body's frame — not the solar system's.
  it('offers RA/Dec from Earth alone', () => {
    expect(frameAvailableFor('equatorial', earth)).toBe(true);
    expect(frameAvailableFor('equatorial', jupiter)).toBe(false);
    expect(frameAvailableFor('equatorial', focus({ kind: 'star', isSol: true }))).toBe(false);
    expect(frameAvailableFor('equatorial', algol)).toBe(false);
  });

  // The rule reads off autoFrameFor, so an object's own default can never be
  // one the availability check would then refuse.
  it('always offers the frame the focus rule itself picks', () => {
    for (const f of [earth, jupiter, algol, focus({ kind: 'probe' }), focus()]) {
      expect(frameAvailableFor(autoFrameFor(f), f)).toBe(true);
    }
  });
});

describe('frameAfterFocusChange', () => {
  const focus = (o: Partial<FocusFrameInputs> = {}): FocusFrameInputs => ({
    kind: null, planetName: null, isSol: false, ...o,
  });
  const earth = focus({ kind: 'planet', planetName: 'Earth' });
  const luna = focus({ kind: 'planet', planetName: 'Luna' });
  const jupiter = focus({ kind: 'planet', planetName: 'Jupiter' });
  const algol = focus({ kind: 'star' });

  it('keeps a frame the new focus still gives meaning to', () => {
    expect(frameAfterFocusChange('ecliptic', luna)).toBe('ecliptic');
    expect(frameAfterFocusChange('ecliptic', jupiter)).toBe('ecliptic');
    expect(frameAfterFocusChange('ecliptic', earth)).toBe('ecliptic');
    expect(frameAfterFocusChange('galactic', algol)).toBe('galactic');
  });

  it('demotes to the new object\'s own default when it does not', () => {
    expect(frameAfterFocusChange('equatorial', luna)).toBe('ecliptic');
    expect(frameAfterFocusChange('ecliptic', algol)).toBe('galactic');
    expect(frameAfterFocusChange('equatorial', algol)).toBe('galactic');
  });

  // The walk the demotion has to reproduce, one focus change at a time.
  it('walks Earth → Luna → Jupiter → Algol as RA/Dec, ecliptic, ecliptic, galactic', () => {
    let frame = frameAfterFocusChange('equatorial', earth);
    expect(frame).toBe('equatorial');
    frame = frameAfterFocusChange(frame, luna);
    expect(frame).toBe('ecliptic');
    frame = frameAfterFocusChange(frame, jupiter);
    expect(frame).toBe('ecliptic');
    frame = frameAfterFocusChange(frame, algol);
    expect(frame).toBe('galactic');
  });

  it('holds an empty grid empty, wherever the focus lands', () => {
    for (const f of [earth, luna, jupiter, algol, focus()]) {
      expect(frameAfterFocusChange('none', f)).toBe('none');
    }
  });

  // Whatever it answers has to survive its own check, or a second focus
  // change to the same object would move the frame again.
  it('is idempotent — the demoted frame is available at the new focus', () => {
    for (const f of [earth, luna, jupiter, algol, focus()]) {
      for (const start of ['none', 'galactic', 'ecliptic', 'equatorial'] as const) {
        const next = frameAfterFocusChange(start, f);
        expect(frameAfterFocusChange(next, f)).toBe(next);
      }
    }
  });
});

describe('captureTargetFrame', () => {
  const attitude = (): Attitude =>
    ({ pitchRad: 0, bankRad: 0, lonRad: 0, sinFromPole: 1 });

  // The whole promise of the stop: whatever you were looking at when you
  // armed it, the destination sits at the ball's origin afterwards.
  it('reads 0/0 in the direction of the destination', () => {
    const camera = cameraLookingAt(new THREE.Vector3(0.3, -0.8, 0.5));
    const toTarget = new THREE.Vector3(-0.2, 0.6, 0.77);
    const frame = captureTargetFrame(camera, toTarget);

    const atTarget = cameraLookingAt(toTarget.clone());
    const out = readAttitude(atTarget, frame, attitude());
    expect(out.pitchRad).toBeCloseTo(0, 9);
    expect(out.lonRad).toBeCloseTo(0, 9);
  });

  it('puts zero longitude exactly on the destination, not merely near it', () => {
    const camera = cameraLookingAt(new THREE.Vector3(1, 0.2, -0.3));
    const toTarget = new THREE.Vector3(0.1, 0.9, 0.42);
    const frame = captureTargetFrame(camera, toTarget);
    expect(frame.zeroLon.angleTo(toTarget.clone().normalize())).toBeCloseTo(0, 9);
    // Which is only possible because the pole was squared against it first.
    expect(frame.pole.dot(frame.zeroLon)).toBeCloseTo(0, 12);
  });

  it('builds the pole from the camera\'s own up', () => {
    const up = new THREE.Vector3(0, 0, 1);
    const camera = cameraLookingAt(new THREE.Vector3(1, 0, 0), up);
    // A destination square to the camera's up leaves that up untouched by the
    // orthogonalisation, so the pole IS the up the user was holding.
    const frame = captureTargetFrame(camera, new THREE.Vector3(1, 0, 0));
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    expect(frame.pole.angleTo(cameraUp)).toBeCloseTo(0, 9);
  });

  it('survives a destination sitting exactly at screen-up', () => {
    const camera = cameraLookingAt(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const frame = captureTargetFrame(camera, cameraUp.clone());

    expect(frame.pole.length()).toBeCloseTo(1, 12);
    expect(frame.zeroLon.length()).toBeCloseTo(1, 12);
    expect(frame.east.length()).toBeCloseTo(1, 12);
    expect(frame.pole.dot(frame.zeroLon)).toBeCloseTo(0, 12);
    // Still aimed at the destination, which is the point of the frame.
    expect(frame.zeroLon.angleTo(cameraUp)).toBeCloseTo(0, 9);
  });

  it('is a snapshot — it does not track a destination that moves', () => {
    const camera = cameraLookingAt(new THREE.Vector3(0, 0, -1));
    const toTarget = new THREE.Vector3(0.5, 0.5, 0.5);
    const frame = captureTargetFrame(camera, toTarget);
    const before = frame.zeroLon.clone();
    toTarget.set(-1, 0, 0);
    expect(frame.zeroLon.equals(before)).toBe(true);
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

// The one rule for whether the orbit lock exists, read by the padlock chip
// and by `Shift`+`L` alike. Every false here is an absence the user can see:
// no travelling datum to ride, or no instrument on screen to ride it from.
describe('orbitLockShowing', () => {
  const showing = (over: Partial<Parameters<typeof orbitLockShowing>[0]> = {}) =>
    orbitLockShowing({
      orbitActive: true, datum: 'off', cameraMode: 'navigate', ...over,
    });

  it('shows on ORB in navigate with no datum held', () => {
    expect(showing()).toBe(true);
  });

  it('hides without ORB — every other frame\'s datum is fixed', () => {
    expect(showing({ orbitActive: false })).toBe(false);
  });

  it.each(['reference', 'target'] as const)(
    'hides with a %s datum held over the top — a fixed datum again',
    (datum) => { expect(showing({ datum })).toBe(false); },
  );

  // The regression: the panel is hidden wholesale in observe without the chip
  // element's own `hidden` changing, so a gate reading only that attribute
  // let the key engage a lock nobody could see — which then took effect on
  // the way back to navigate. The ride is meaningless there too: it orbits
  // the camera about `controls.target`, and observe's camera sits on the
  // object rather than circling it.
  it('hides in observe, even with ORB armed and no datum held', () => {
    expect(showing({ cameraMode: 'observe' })).toBe(false);
  });
});
