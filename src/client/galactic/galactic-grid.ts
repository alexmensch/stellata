import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { galacticDirToIcrs } from './galactic-coords';
import { CHART_REFERENCE_INK } from '../chart-mode/chart-palette';
import { setBuiltinChromeColour } from '../hdr/chrome-colour';

export const SPHERE_RADIUS_PC = 50_000;
const EQUATOR_SEGMENTS = 256;
const LATITUDE_SEGMENTS = 192;
const MERIDIAN_SEGMENTS = 96;
export const MERIDIAN_COUNT = 36;   // every 10° of l
// Latitudes every 10° (excluding 0° = equator, which is the fat Line2).
export const LATITUDES_DEG = [-80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80];
// Meridians whose longitude is a multiple of 20° run pole-to-pole; the
// off-by-10° meridians stop at ±MERIDIAN_TRIM_LATITUDE_DEG so that the
// every-20° set near the poles stays uncluttered while the in-between
// lines fade out before they bunch up.
const MERIDIAN_TRIM_LATITUDE_DEG = 80;

/** Absolute latitude extent (degrees) a meridian is drawn to: even indices
 *  reach the pole, odd ones stop at the trim so 36 lines ease to 18 near the
 *  poles. Shared with galactic-grid-labels so labels never anchor past the
 *  drawn line end. */
export function meridianMaxAbsBDeg(index: number): number {
  return index % 2 === 0 ? 90 : MERIDIAN_TRIM_LATITUDE_DEG;
}

// Equator gets the fat-line treatment (Line2 + LineMaterial) for genuine
// screen-space width on every platform — `LineBasicMaterial.linewidth`
// silently clamps to 1 in WebGL on Chrome/Win, so it's never reliable.
const EQUATOR_LINEWIDTH_PX = 2.4;

const DARK_COLOUR = 0x6688aa;

// Equator visually marked: stronger opacity than ordinary lat/meridian lines
// so the b=0 plane reads as the "spine" of the grid.
const DARK_EQUATOR_OPACITY = 0.7;
const DARK_LINE_OPACITY = 0.45;

/**
 * Toggleable galactic coordinate sphere — a "sky from here" reference grid.
 * Equator + 16 latitude rings every 10° (b=±10°…±80°) + 36 meridians every
 * 10° of l, no pole markers. All baked once in the galactic frame and
 * rotated into ICRS via galacticDirToIcrs. Orientation labels along the
 * grid lines live in galactic-grid-labels.ts.
 *
 * Per frame the group's position tracks `camera.position` (in local frame)
 * so the sphere is always centred on the observer — the grid lines feel
 * fixed against the sky regardless of where the camera flies, and the
 * b=0/l=0 directions stay correctly oriented because galactic axes are
 * fixed in absolute space and the geometry is already in ICRS.
 *
 * Mono mode swaps to dark, fully-opaque strokes for the chart aesthetic;
 * the equator/line opacity split is preserved by stroke weight rather than
 * alpha, since chart-mode fades aren't on the table.
 */
export class GalacticGrid {
  readonly group: THREE.Group;
  private equatorMaterial: LineMaterial;
  private lineMaterial: THREE.LineBasicMaterial;
  private mono = false;

  constructor() {
    this.group = new THREE.Group();
    this.group.renderOrder = -1;

    this.equatorMaterial = new LineMaterial({
      linewidth: EQUATOR_LINEWIDTH_PX,
      transparent: true,
      opacity: DARK_EQUATOR_OPACITY,
      depthTest: true,
      worldUnits: false,
    });
    // Resolution must be set or the line renders at the wrong width.
    // Stellata's onResize keeps this in sync with the canvas.
    this.equatorMaterial.resolution.set(window.innerWidth, window.innerHeight);
    // depthWrite isn't on LineMaterial's typed constructor; assign directly.
    this.equatorMaterial.depthWrite = false;

    this.lineMaterial = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: DARK_LINE_OPACITY,
      depthTest: true,
      depthWrite: false,
    });
    setBuiltinChromeColour(this.equatorMaterial.color, DARK_COLOUR);
    setBuiltinChromeColour(this.lineMaterial.color, DARK_COLOUR);

    this.group.add(this.makeFatEquator());
    for (const bDeg of LATITUDES_DEG) {
      this.group.add(this.makeLatitudeRing(
        (bDeg * Math.PI) / 180,
        LATITUDE_SEGMENTS,
        this.lineMaterial,
      ));
    }

    for (let i = 0; i < MERIDIAN_COUNT; i++) {
      const lRad = (i / MERIDIAN_COUNT) * Math.PI * 2;
      const bMaxAbsRad = (meridianMaxAbsBDeg(i) * Math.PI) / 180;
      this.group.add(
        this.makeMeridian(lRad, MERIDIAN_SEGMENTS, this.lineMaterial, bMaxAbsRad),
      );
    }
  }

  /** Centre the sphere on the camera each frame. */
  update(cameraPosition: THREE.Vector3) {
    this.group.position.copy(cameraPosition);
  }

  /** Keep LineMaterial.resolution in sync with the canvas — Line2's
   *  pixel-width is computed in the shader from this uniform. */
  setResolution(w: number, h: number) {
    this.equatorMaterial.resolution.set(w, h);
  }

  setMonochrome(on: boolean) {
    if (this.mono === on) return;
    this.mono = on;
    const colour = on ? CHART_REFERENCE_INK : DARK_COLOUR;

    setBuiltinChromeColour(this.equatorMaterial.color, colour, on);
    setBuiltinChromeColour(this.lineMaterial.color, colour, on);
    if (on) {
      this.equatorMaterial.transparent = false;
      this.equatorMaterial.opacity = 1;
      this.lineMaterial.transparent = false;
      this.lineMaterial.opacity = 1;
      this.lineMaterial.blending = THREE.NoBlending;
    } else {
      this.equatorMaterial.transparent = true;
      this.equatorMaterial.opacity = DARK_EQUATOR_OPACITY;
      this.lineMaterial.transparent = true;
      this.lineMaterial.opacity = DARK_LINE_OPACITY;
      this.lineMaterial.blending = THREE.NormalBlending;
    }
    this.equatorMaterial.needsUpdate = true;
    this.lineMaterial.needsUpdate = true;
  }

  /** Build the b=0 equator as a fat Line2 so it stays visually thicker than
   *  the rest of the grid regardless of platform/zoom. Vertices baked once
   *  in galactic frame and rotated to ICRS; the loop is closed by repeating
   *  the first vertex at the end (Line2 is an open polyline). */
  private makeFatEquator(): Line2 {
    const tmp = new THREE.Vector3();
    const n = EQUATOR_SEGMENTS;
    const positions = new Array(n * 3 + 3);
    let firstX = 0, firstY = 0, firstZ = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      galacticDirToIcrs(t, 0, tmp).multiplyScalar(SPHERE_RADIUS_PC);
      positions[i * 3 + 0] = tmp.x;
      positions[i * 3 + 1] = tmp.y;
      positions[i * 3 + 2] = tmp.z;
      if (i === 0) { firstX = tmp.x; firstY = tmp.y; firstZ = tmp.z; }
    }
    positions[n * 3 + 0] = firstX;
    positions[n * 3 + 1] = firstY;
    positions[n * 3 + 2] = firstZ;

    const geom = new LineGeometry();
    geom.setPositions(positions);
    const line = new Line2(geom, this.equatorMaterial);
    line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = -1;
    return line;
  }

  private makeLatitudeRing(
    bRad: number,
    segments: number,
    material: THREE.LineBasicMaterial,
  ): THREE.LineLoop {
    const v = new Float32Array(segments * 3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      galacticDirToIcrs(t, bRad, tmp).multiplyScalar(SPHERE_RADIUS_PC);
      v[i * 3 + 0] = tmp.x;
      v[i * 3 + 1] = tmp.y;
      v[i * 3 + 2] = tmp.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(v, 3));
    const loop = new THREE.LineLoop(geom, material);
    loop.frustumCulled = false;
    loop.renderOrder = -1;
    return loop;
  }

  private makeMeridian(
    lRad: number,
    segments: number,
    material: THREE.LineBasicMaterial,
    bMaxAbsRad: number = Math.PI / 2,
  ): THREE.Line {
    // Meridian sweeps b from -bMaxAbsRad to +bMaxAbsRad at fixed l. We draw
    // it as a single Line (open polyline) so the south-to-north arc renders
    // without an unwanted closing segment between poles. bMaxAbsRad < π/2
    // trims the meridian short of the poles.
    const v = new Float32Array((segments + 1) * 3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const b = -bMaxAbsRad + (i / segments) * (2 * bMaxAbsRad);
      galacticDirToIcrs(lRad, b, tmp).multiplyScalar(SPHERE_RADIUS_PC);
      v[i * 3 + 0] = tmp.x;
      v[i * 3 + 1] = tmp.y;
      v[i * 3 + 2] = tmp.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(v, 3));
    const line = new THREE.Line(geom, material);
    line.frustumCulled = false;
    line.renderOrder = -1;
    return line;
  }

  dispose() {
    for (const child of this.group.children) {
      const g = (child as { geometry?: THREE.BufferGeometry }).geometry;
      g?.dispose();
    }
    this.equatorMaterial.dispose();
    this.lineMaterial.dispose();
  }
}
