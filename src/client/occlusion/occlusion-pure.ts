// The angular occlusion test behind a label anchor's visibility: does a
// nearer solid body hide this point from the camera.

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
