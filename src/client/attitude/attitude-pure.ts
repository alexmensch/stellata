// Camera attitude relative to a reference frame: pitch, bank and boresight
// longitude. Frame-agnostic — the pole and the frame's zero-longitude
// direction are arguments.

import * as THREE from 'three';
import {
  cameraLocalUpInto,
  levelUpInto,
  signedAngleAbout,
} from '../camera/controls/input/reference-up-pure';
import { galacticDirToIcrs } from '../galactic/galactic-coords';
import type { TargetKind } from '../camera/focus/focus-target';

export type ReferenceFrameKey =
  | 'equatorial'
  | 'ecliptic'
  | 'galactic'
  | 'reference'
  | 'orbit';

/** Every frame the instrument can reach on its own. The two captured data are
 *  missing on purpose: `reference` is built from an attitude the user is
 *  holding and `orbit` from whatever is focused, so neither can be tabulated
 *  ahead of time. */
export type AutoFrameKey = Exclude<ReferenceFrameKey, 'reference' | 'orbit'>;

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

const OBLIQUITY_RAD = (23.4392911 * Math.PI) / 180;

// Boresight this close to a captured pole leaves no zero-longitude
// direction to project — 1e-3 rad off the axis.
const DEGENERATE_SEED_COS = Math.cos(1e-3);

function makeFrame(
  key: ReferenceFrameKey,
  label: string,
  pole: THREE.Vector3,
  zeroLonSeed: THREE.Vector3,
): ReferenceFrame {
  const p = pole.clone().normalize();
  const zeroLon = zeroLonSeed
    .clone()
    .addScaledVector(p, -zeroLonSeed.dot(p))
    .normalize();
  return {
    key,
    label,
    pole: p,
    zeroLon,
    east: new THREE.Vector3().crossVectors(p, zeroLon),
  };
}

/** Shuttle's ATT REF: plant a datum on the attitude the camera holds right
 *  now, so the ball reads 0/0 level from here. The camera's own up and
 *  boresight are already perpendicular, which is exactly a frame. */
export function captureReferenceFrame(camera: THREE.Camera): ReferenceFrame {
  const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const boresight = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  return makeFrame('reference', 'REF', pole, boresight);
}

/** A frame on the focused object's own orbital plane. `normal` is the
 *  orbit's angular-momentum direction, so a retrograde orbit reads
 *  inverted — that is the plane's real sense, not a display choice.
 *
 *  Zero longitude seeds off the boresight, as REF does, giving the same
 *  "level from where you are" read. Sighting straight down the pole makes
 *  that seed degenerate, and the camera's up takes over: it is
 *  perpendicular to the boresight, hence to the pole in exactly that
 *  case. */
export function captureOrbitFrame(
  camera: THREE.Camera,
  normal: THREE.Vector3,
): ReferenceFrame {
  const boresight = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const seed = Math.abs(boresight.dot(normal)) > DEGENERATE_SEED_COS
    ? new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    : boresight;
  return makeFrame('orbit', 'ORB', normal, seed);
}

export function buildReferenceFrames(): Record<AutoFrameKey, ReferenceFrame> {
  const eclipticPole = new THREE.Vector3(
    0,
    -Math.sin(OBLIQUITY_RAD),
    Math.cos(OBLIQUITY_RAD),
  );
  const galacticCentre = galacticDirToIcrs(0, 0, new THREE.Vector3());
  const galacticPole = galacticDirToIcrs(0, Math.PI / 2, new THREE.Vector3());
  return {
    equatorial: makeFrame(
      'equatorial',
      'EQU',
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
    ),
    ecliptic: makeFrame('ecliptic', 'ECL', eclipticPole, new THREE.Vector3(1, 0, 0)),
    galactic: makeFrame('galactic', 'GAL', galacticPole, galacticCentre),
  };
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

export const FRAME_CYCLE: AutoFrameKey[] = [
  'equatorial',
  'ecliptic',
  'galactic',
];

/** The flag's next stop, with the cycle rotated so the focus default leads.
 *
 *  Rotating a cycle leaves every successor unchanged, so this only bites on the
 *  way **out of a captured frame** (REF or ORB) — a captured datum sits outside
 *  the cycle and has no successor of its own, and dropping back to a fixed first
 *  entry would strand you on a frame that means nothing where you are. Leaving
 *  one therefore lands on whatever the focused object implies. */
export function nextFrameKey(
  current: ReferenceFrameKey,
  focusDefault: AutoFrameKey,
): AutoFrameKey {
  const at = (FRAME_CYCLE as readonly ReferenceFrameKey[]).indexOf(current);
  if (at < 0) return focusDefault;
  return FRAME_CYCLE[(at + 1) % FRAME_CYCLE.length];
}

/** Bank is the angle to a level up that shrinks to nothing on the pole, so
 *  inside this cone the reading is float noise rather than a measurement and
 *  the last one stands. Two decades tighter than the roll correction's own
 *  `POLE_CONE_DEG`, which eases the *camera* rather than the readout. */
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
