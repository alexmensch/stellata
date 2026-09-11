// The angular occlusion test behind a label anchor's visibility: does a
// nearer solid body hide this point from the camera.

import { scalePolarInto } from '../util/polar-scale';

/**
 * True when the sphere at `(oX, oY, oZ)` of radius `radiusPc` hides the
 * point `(aX, aY, aZ)` from a camera at `(camX, camY, camZ)`. Every
 * argument is renderer-local, in parsecs.
 */
export function sphereHidesPoint(
  camX: number, camY: number, camZ: number,
  aX: number, aY: number, aZ: number,
  oX: number, oY: number, oZ: number,
  radiusPc: number,
): boolean {
  if (!(radiusPc > 0)) return false;

  const ox = oX - camX, oy = oY - camY, oz = oZ - camZ;
  const dOcc = Math.sqrt(ox * ox + oy * oy + oz * oz);
  // A camera at or inside the surface: the resolved surface owns the
  // whole viewport there and every verdict this would return is noise.
  if (!(dOcc > radiusPc)) return false;

  const ax = aX - camX, ay = aY - camY, az = aZ - camZ;
  const dAnc = Math.sqrt(ax * ax + ay * ay + az * az);
  // The anchor must clear the FAR surface, not the centre. Narrowing
  // this to `dAnc > dOcc` makes every body hide its own anchor, and
  // leaves one straddling the limb flickering as its depth crosses.
  if (!(dAnc > dOcc + radiusPc)) return false;

  // atan2(|cross|, dot) rather than acos(dot / |a||o|): the verdict
  // flips at small angular separations, where acos loses its precision.
  const cX = ay * oz - az * oy;
  const cY = az * ox - ax * oz;
  const cZ = ax * oy - ay * ox;
  const sinT = Math.sqrt(cX * cX + cY * cY + cZ * cZ);
  const cosT = ax * ox + ay * oy + az * oz;
  return Math.atan2(sinT, cosT) < Math.asin(radiusPc / dOcc);
}

const camScratch: [number, number, number] = [0, 0, 0];
const ancScratch: [number, number, number] = [0, 0, 0];

/**
 * True when the body at `(oX, oY, oZ)` hides the point `(aX, aY, aZ)` from
 * a camera at `(camX, camY, camZ)`. The body is the spheroid the renderer
 * DRAWS: `equatorialRadiusPc` across, `polarRatio × equatorialRadiusPc`
 * along the unit axis `(poleX, poleY, poleZ)`.
 *
 * Exact for a squashed body rather than a closer approximation to it.
 * Scaling the pole component of both endpoints by `1 / polarRatio` carries
 * the spheroid onto its equatorial sphere and every sight line onto a sight
 * line (`../util/polar-scale.ts`), so the verdict survives the map and the
 * sphere test answers it outright.
 */
export function spheroidHidesPoint(
  camX: number, camY: number, camZ: number,
  aX: number, aY: number, aZ: number,
  oX: number, oY: number, oZ: number,
  equatorialRadiusPc: number,
  polarRatio: number,
  poleX: number, poleY: number, poleZ: number,
): boolean {
  if (polarRatio === 1) {
    return sphereHidesPoint(
      camX, camY, camZ, aX, aY, aZ, oX, oY, oZ, equatorialRadiusPc);
  }
  if (!(polarRatio > 0)) return false;

  const s = 1 / polarRatio;
  scalePolarInto(camX - oX, camY - oY, camZ - oZ, poleX, poleY, poleZ, s, camScratch);
  scalePolarInto(aX - oX, aY - oY, aZ - oZ, poleX, poleY, poleZ, s, ancScratch);
  return sphereHidesPoint(
    camScratch[0], camScratch[1], camScratch[2],
    ancScratch[0], ancScratch[1], ancScratch[2],
    0, 0, 0,
    equatorialRadiusPc,
  );
}
