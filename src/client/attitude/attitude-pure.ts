// Camera attitude relative to a reference frame: pitch, bank and boresight
// longitude. Frame-agnostic — the pole and the frame's zero-longitude
// direction are arguments.

import * as THREE from 'three';
import {
  cameraLocalUpInto,
  levelUpInto,
  signedAngleAbout,
} from '../camera/controls/input/roll-pure';
import {
  COORD_SPHERE_SPECS,
  DRAWN_COORD_SPHERE_FRAMES,
} from '../galactic/coord-spheres/coord-sphere-frames';
import type {
  CoordSphereFrame,
  DrawnCoordSphereFrame,
} from '../galactic/coord-spheres/coord-sphere';
import type { TargetKind } from '../camera/focus/focus-target';

export type ReferenceFrameKey =
  | DrawnCoordSphereFrame
  | 'reference'
  | 'target'
  | 'orbit';

/** Every frame the instrument can reach on its own — exactly the frames that
 *  have a sphere behind them, so the ball and the grid can never offer
 *  different sets. The three captured data are missing on purpose:
 *  `reference` is built from an attitude the user is holding, `target` from a
 *  bearing to the destination, and `orbit` from whatever is focused, so none
 *  can be tabulated ahead of time. */
export type AutoFrameKey = DrawnCoordSphereFrame;

export interface ReferenceFrame {
  key: ReferenceFrameKey;
  label: string;
  pole: THREE.Vector3;
  zeroLon: THREE.Vector3;
  east: THREE.Vector3;
}

export interface Attitude {
  pitchRad: number;
  bankRad: number;
  lonRad: number;
  sinFromPole: number;
}

// Boresight this close to a captured pole leaves no zero-longitude
// direction to project — 1e-3 rad off the axis.
const DEGENERATE_SEED_COS = Math.cos(1e-3);

/** An empty frame to write into. Only a caller that rebuilds a frame every
 *  tick needs one — `emptyReferenceFrame()` plus the `*Into` builders below
 *  keep that path allocation-free. */
export function emptyReferenceFrame(): ReferenceFrame {
  return {
    key: 'galactic',
    label: '',
    pole: new THREE.Vector3(0, 1, 0),
    zeroLon: new THREE.Vector3(1, 0, 0),
    east: new THREE.Vector3(0, 0, 1),
  };
}

function makeFrameInto(
  out: ReferenceFrame,
  key: ReferenceFrameKey,
  label: string,
  pole: THREE.Vector3,
  zeroLonSeed: THREE.Vector3,
): ReferenceFrame {
  out.key = key;
  out.label = label;
  out.pole.copy(pole).normalize();
  out.zeroLon
    .copy(zeroLonSeed)
    .addScaledVector(out.pole, -zeroLonSeed.dot(out.pole))
    .normalize();
  out.east.crossVectors(out.pole, out.zeroLon);
  return out;
}

function makeFrame(
  key: ReferenceFrameKey,
  label: string,
  pole: THREE.Vector3,
  zeroLonSeed: THREE.Vector3,
): ReferenceFrame {
  return makeFrameInto(emptyReferenceFrame(), key, label, pole, zeroLonSeed);
}

/** Shuttle's ATT REF: plant a datum on the attitude the camera holds right
 *  now, so the ball reads 0/0 level from here. The camera's own up and
 *  boresight are already perpendicular, which is exactly a frame. */
export function captureReferenceFrame(camera: THREE.Camera): ReferenceFrame {
  const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const boresight = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return makeFrame('reference', 'REF', pole, boresight);
}

/** A frame on the focused object's own orbital plane, seeding zero
 *  longitude on `toCentre` — `orbit-frame/README.md`.
 *
 *  Two fallbacks in order, both for degenerate cases a real orbit does not
 *  produce: a `toCentre` collapsing to nothing hands the seed to the
 *  boresight, and a boresight down the pole hands it to the camera's up. */
export function captureOrbitFrame(
  camera: THREE.Camera,
  normal: THREE.Vector3,
  toCentre: THREE.Vector3,
): ReferenceFrame {
  return orbitFrameInto(emptyReferenceFrame(), camera, normal, toCentre);
}

const orbitBoresight = new THREE.Vector3();
const orbitSeed = new THREE.Vector3();

/** `captureOrbitFrame` writing into `out`. The instrument rebuilds ORB every
 *  tick (`orbit-frame/README.md` § Orbit rate), so this path runs per rendered
 *  frame and allocates nothing. */
export function orbitFrameInto(
  out: ReferenceFrame,
  camera: THREE.Camera,
  normal: THREE.Vector3,
  toCentre: THREE.Vector3,
): ReferenceFrame {
  orbitBoresight.set(0, 0, -1).applyQuaternion(camera.quaternion);
  orbitSeed.copy(toCentre).addScaledVector(normal, -toCentre.dot(normal));
  if (orbitSeed.lengthSq() === 0) {
    if (Math.abs(orbitBoresight.dot(normal)) > DEGENERATE_SEED_COS) {
      orbitSeed.set(0, 1, 0).applyQuaternion(camera.quaternion);
    } else {
      orbitSeed.copy(orbitBoresight);
    }
  }
  return makeFrameInto(out, 'orbit', 'ORB', normal, orbitSeed);
}

/** A datum aimed at the distance-vector destination: zero longitude points
 *  straight at it, so the ball reads 0/0 exactly where the target lies and
 *  bank still reads against the attitude you were holding. Squaring the
 *  camera's own up against that direction — rather than handing it to
 *  `makeFrame` to project — is what puts the target on the equator instead of
 *  merely somewhere in the frame.
 *
 *  `toTarget` is a direction, not a position; the caller resolves it, and the
 *  datum is a snapshot like REF's. */
export function captureTargetFrame(
  camera: THREE.Camera,
  toTarget: THREE.Vector3,
): ReferenceFrame {
  const dir = toTarget.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  // Up runs parallel to the target only with the target exactly at screen-up,
  // where it leaves no pole to build; the camera's right cannot be parallel
  // to it at the same time.
  const seed = Math.abs(up.dot(dir)) > DEGENERATE_SEED_COS
    ? new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    : up;
  return makeFrame('target', 'TGT', seed.addScaledVector(dir, -seed.dot(dir)), dir);
}

/** How far the orbit lock should carry the camera this frame: the signed
 *  turn from where the datum was last ridden from to where it is now, read
 *  about the orbit pole — or **zero while that is under `minRad`**.
 *
 *  The threshold is what keeps the lock inside the render gate's schedule
 *  rather than defeating it. The ride writes the camera below the gate, so
 *  the next tick reads any write at all as a fresh camera move and renders;
 *  at live 1x a moon's datum turns a few millionths of a degree per tick,
 *  which would pin the gate open forever for a step no display can show
 *  (`orbit-frame/README.md` § The lock).
 *
 *  A caller that gets 0 must leave `from` where it is, so the turns
 *  accumulate into one that is worth riding instead of being dropped. */
export function orbitRideTurn(
  from: THREE.Vector3,
  to: THREE.Vector3,
  pole: THREE.Vector3,
  minRad: number,
): number {
  const turn = signedAngleAbout(from, to, pole);
  return Math.abs(turn) < minRad ? 0 : turn;
}

const rideOffset = new THREE.Vector3();

/** Carry a camera pose round `pivot` by `angle` about `axis`, writing both
 *  `position` and `up` in place — the orbit lock's whole motion.
 *
 *  Turning the pose by exactly what the frame turned is what leaves the
 *  attitude reading unchanged, so the ball holds still while the world moves
 *  under it. One axis-angle covers both halves because ORB's pole is static:
 *  only zero longitude travels, so the swing about the pivot and the roll are
 *  the same rotation. */
export function ridePoseAbout(
  position: THREE.Vector3,
  up: THREE.Vector3,
  pivot: THREE.Vector3,
  axis: THREE.Vector3,
  angle: number,
): void {
  rideOffset.copy(position).sub(pivot).applyAxisAngle(axis, angle);
  position.copy(pivot).add(rideOffset);
  up.applyAxisAngle(axis, angle).normalize();
}

const FRAME_LABELS: Record<AutoFrameKey, string> = {
  galactic: 'GAL',
  ecliptic: 'ECL',
  equatorial: 'EQU',
};

/** Both axes of every frame are read off the drawn sphere's own `dirToIcrs`,
 *  which is what stops the instrument and the grid disagreeing about a frame:
 *  there is one definition of galactic north, not a matching pair. */
export function buildReferenceFrames(): Record<AutoFrameKey, ReferenceFrame> {
  const frames = {} as Record<AutoFrameKey, ReferenceFrame>;
  for (const key of DRAWN_COORD_SPHERE_FRAMES) {
    const { dirToIcrs } = COORD_SPHERE_SPECS[key];
    frames[key] = makeFrame(
      key,
      FRAME_LABELS[key],
      dirToIcrs(0, Math.PI / 2, new THREE.Vector3()),
      dirToIcrs(0, 0, new THREE.Vector3()),
    );
  }
  return frames;
}

/** What the frame rule needs to know about the focused object, resolved by the
 *  caller so the rule itself stays a plain decision over values. */
export interface FocusFrameInputs {
  kind: TargetKind | null;
  /** Only consulted for a planet: Earth is the one body whose sky is read in
   *  RA/Dec rather than against the ecliptic. */
  planetName: string | null;
  isSol: boolean;
}

/** Which frame the focused object implies. Everything in Sol's system rides
 *  the ecliptic — that is the plane its planets actually orbit in — with Earth
 *  the single exception, where RA/Dec is the frame anyone reading the sky from
 *  the surface already thinks in. Beyond the system, galactic is the only frame
 *  still defined by something real. */
export function autoFrameFor(focus: FocusFrameInputs): AutoFrameKey {
  if (focus.kind === null) return 'galactic';
  if (focus.kind === 'planet') {
    return focus.planetName === 'Earth' ? 'equatorial' : 'ecliptic';
  }
  if (focus.kind === 'probe') return 'ecliptic';
  if (focus.kind === 'star' && focus.isSol) return 'ecliptic';
  return 'galactic';
}

/** Does `frame` describe anything real from the focused object? Read off the
 *  focus rule above rather than restating "in Sol's system", so the two can
 *  never drift apart:
 *
 *  - **galactic** everywhere — the disc is a real structure whichever star you
 *    are standing on.
 *  - **ecliptic** wherever the focus rule already lands inside Sol's system,
 *    which is exactly where its planets' shared orbital plane is a reference
 *    rather than an arbitrary tilt.
 *  - **equatorial** on Earth alone. Declination is measured from Earth's own
 *    rotational axis and right ascension from its equinox, so the frame is a
 *    property of that one body. */
export function frameAvailableFor(frame: AutoFrameKey, focus: FocusFrameInputs): boolean {
  const home = autoFrameFor(focus);
  if (frame === 'galactic') return true;
  if (frame === 'ecliptic') return home !== 'galactic';
  return home === 'equatorial';
}

/** The frame to hold once the focus has changed: the one already selected
 *  when the new focus still gives it meaning, otherwise that object's own
 *  default. Keeping the pick is what lets a tour of Sol's system stay on the
 *  ecliptic, while stepping outside it demotes rather than leaving a grid
 *  measuring nothing. `none` survives anywhere — an empty sky is an empty sky.
 */
export function frameAfterFocusChange(
  current: CoordSphereFrame,
  focus: FocusFrameInputs,
): CoordSphereFrame {
  if (current === 'none') return 'none';
  return frameAvailableFor(current, focus) ? current : autoFrameFor(focus);
}

/** Every frame the flag itself can reach. The two datums stay outside it:
 *  neither an attitude being held right now nor a bearing to a destination has
 *  a fixed place in a rotation, so both are only ever reached by the chip that
 *  captures them. */
export type CycleFrameKey = Exclude<ReferenceFrameKey, 'reference' | 'target'>;

export const FRAME_CYCLE: CycleFrameKey[] = ['orbit', ...DRAWN_COORD_SPHERE_FRAMES];

/** The flag's next stop — the navigate-mode `S` cycle, and the same walk the
 *  panel's stop control offers in observe minus its `none`.
 *
 *  Every entry is conditional on what is focused: ORB on the object riding an
 *  orbit the model has elements for, the three sky frames on `available`. Both
 *  are properties of the focus rather than of the instrument. Galactic is
 *  available everywhere, so the walk always terminates.
 *
 *  Leaving REF is the one case with no successor to step to, and it lands on
 *  whatever the focused object implies rather than a fixed first entry, which
 *  would strand you on a frame that means nothing where you are. */
export function nextFrameKey(
  current: ReferenceFrameKey,
  focusDefault: AutoFrameKey,
  orbitAvailable: boolean,
  available: (frame: AutoFrameKey) => boolean,
): CycleFrameKey {
  const at = (FRAME_CYCLE as readonly ReferenceFrameKey[]).indexOf(current);
  if (at < 0) return focusDefault;
  for (let step = 1; step <= FRAME_CYCLE.length; step++) {
    const next = FRAME_CYCLE[(at + step) % FRAME_CYCLE.length];
    if (next === 'orbit' ? orbitAvailable : available(next)) return next;
  }
  return focusDefault;
}

/** Bank is the angle to a level up that shrinks to nothing on the pole, so
 *  inside this cone the reading is float noise rather than a measurement and
 *  the last one stands. */
export const POLE_HOLD_DEG = 1;
const POLE_HOLD_SIN = Math.sin((POLE_HOLD_DEG * Math.PI) / 180);

const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const level = new THREE.Vector3();

export function readAttitude(
  camera: THREE.Camera,
  frame: ReferenceFrame,
  out: Attitude,
): Attitude {
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  cameraLocalUpInto(up, camera);

  out.pitchRad = Math.asin(Math.min(1, Math.max(-1, forward.dot(frame.pole))));
  out.lonRad = Math.atan2(forward.dot(frame.east), forward.dot(frame.zeroLon));

  const sinTheta = levelUpInto(level, frame.pole, forward);
  out.sinFromPole = sinTheta;
  if (sinTheta > POLE_HOLD_SIN) out.bankRad = signedAngleAbout(up, level, forward);
  return out;
}

/** A frame direction in the ball's own coordinates: pole along +Y, zero
 *  longitude at +X, longitude increasing toward −Z. The sphere's poles are
 *  fixed on +Y by `THREE.SphereGeometry`, and the −Z is what keeps the basis
 *  right-handed given `east = pole × zeroLon`. */
export function frameDirToBallInto(
  out: THREE.Vector3,
  dir: THREE.Vector3,
  frame: ReferenceFrame,
): THREE.Vector3 {
  return out.set(dir.dot(frame.zeroLon), dir.dot(frame.pole), -dir.dot(frame.east));
}

const right = new THREE.Vector3();
const basisX = new THREE.Vector3();
const basisY = new THREE.Vector3();
const basisZ = new THREE.Vector3();

/** A frame axis resolved onto the camera's own right / up / forward, which is
 *  where the instrument's +X / +Y / +Z point. Reads the scratch above, so the
 *  caller sets those first. */
function projectInto(
  out: THREE.Vector3,
  dir: THREE.Vector3,
  sign: number,
): THREE.Vector3 {
  return out
    .set(dir.dot(right), dir.dot(up), dir.dot(forward))
    .multiplyScalar(sign);
}

/** The ball's model matrix: ball coordinates → instrument coordinates (+X
 *  right, +Y up, +Z toward the viewer).
 *
 *  **Determinant is −1 — this is a reflection, and that is the whole trick.**
 *  A direction lands on the instrument exactly where it lands on screen in the
 *  real view, so the ball's grid is a true miniature of the coordinate sphere
 *  the scene draws, with the boresight at the centre. A pure rotation cannot
 *  do that: it would put the *anti*-boresight at the centre, because a globe
 *  read from outside is the mirror of a sky read from inside. Two consequences
 *  callers must honour — the texture has to be drawn mirrored in longitude to
 *  read the right way round, and a lit material would light the far side, so
 *  the ball is unlit with its shading faked on top. */
export function ballBasisInto(
  out: THREE.Matrix4,
  camera: THREE.Camera,
  frame: ReferenceFrame,
): THREE.Matrix4 {
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  cameraLocalUpInto(up, camera);
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);

  return out.makeBasis(
    projectInto(basisX, frame.zeroLon, 1),
    projectInto(basisY, frame.pole, 1),
    projectInto(basisZ, frame.east, -1),
  );
}
