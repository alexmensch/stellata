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

export type ReferenceFrameKey = 'equatorial' | 'ecliptic' | 'galactic';

export interface ReferenceFrame {
  key: ReferenceFrameKey;
  label: string;
  latSymbol: string;
  lonSymbol: string;
  pole: THREE.Vector3;
  zeroLon: THREE.Vector3;
  east: THREE.Vector3;
  formatLon(rad: number): string;
}

export interface Attitude {
  pitchRad: number;
  bankRad: number;
  lonRad: number;
  sinFromPole: number;
}

const OBLIQUITY_RAD = (23.4392911 * Math.PI) / 180;

function makeFrame(
  key: ReferenceFrameKey,
  label: string,
  latSymbol: string,
  lonSymbol: string,
  pole: THREE.Vector3,
  zeroLonSeed: THREE.Vector3,
  formatLon: (rad: number) => string,
): ReferenceFrame {
  const p = pole.clone().normalize();
  const zeroLon = zeroLonSeed
    .clone()
    .addScaledVector(p, -zeroLonSeed.dot(p))
    .normalize();
  return {
    key,
    label,
    latSymbol,
    lonSymbol,
    pole: p,
    zeroLon,
    east: new THREE.Vector3().crossVectors(p, zeroLon),
    formatLon,
  };
}

export function formatDegrees(rad: number): string {
  const deg = ((rad * 180) / Math.PI + 360) % 360;
  return `${deg.toFixed(1)}°`;
}

export function formatHours(rad: number): string {
  const hours = ((rad * 12) / Math.PI + 24) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${h}h${String(m).padStart(2, '0')}m`;
}

export function formatLatitude(rad: number): string {
  const deg = (rad * 180) / Math.PI;
  return `${deg >= 0 ? '+' : '−'}${Math.abs(deg).toFixed(1)}°`;
}

export function buildReferenceFrames(): Record<ReferenceFrameKey, ReferenceFrame> {
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
      'δ',
      'α',
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
      formatHours,
    ),
    ecliptic: makeFrame(
      'ecliptic',
      'ECL',
      'β',
      'λ',
      eclipticPole,
      new THREE.Vector3(1, 0, 0),
      formatDegrees,
    ),
    galactic: makeFrame(
      'galactic',
      'GAL',
      'b',
      'l',
      galacticPole,
      galacticCentre,
      formatDegrees,
    ),
  };
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

  const project = (d: THREE.Vector3, sign: number) =>
    new THREE.Vector3(d.dot(right), d.dot(up), d.dot(forward)).multiplyScalar(sign);

  return out.makeBasis(
    project(frame.zeroLon, 1),
    project(frame.pole, 1),
    project(frame.east, -1),
  );
}
