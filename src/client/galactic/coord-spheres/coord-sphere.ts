// The observer-centred coordinate sphere: one grid geometry, parametrised by
// the frame its longitude/latitude resolve into. See galactic/README.md
// § Coordinate spheres.

import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CHART_REFERENCE_INK } from '../../chart-mode/chart-palette';
import type { SolFrameFadeWindow } from '../galactic-fade';
import { setBuiltinChromeColour } from '../../hdr/chrome/chrome-colour';

export const SPHERE_RADIUS_PC = 50_000;
const EQUATOR_SEGMENTS = 256;
const LATITUDE_SEGMENTS = 192;
const MERIDIAN_SEGMENTS = 96;
// Latitudes every 10° (excluding 0° = equator, which is the fat Line2).
export const LATITUDES_DEG = [-80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80];
// Alternate meridians stop at ±MERIDIAN_TRIM_LATITUDE_DEG so half the set
// thins out before the lines bunch up at the poles, whatever the spacing.
const MERIDIAN_TRIM_LATITUDE_DEG = 80;

/** Which coordinate sphere the user has up. Mutually exclusive: two grids
 *  drawn together are illegible, and their edge labels would fight in one
 *  repulsion pass. */
export type CoordSphereFrame = 'none' | 'galactic' | 'equatorial';

/** A frame that has a sphere behind it — every `CoordSphereFrame` but `none`. */
export type DrawnCoordSphereFrame = Exclude<CoordSphereFrame, 'none'>;

/**
 * Longitude/latitude (radians) in some sky frame → the ICRS unit direction,
 * written into `out`.
 */
export type DirToIcrs = (lonRad: number, latRad: number, out: THREE.Vector3) => THREE.Vector3;

/**
 * Everything that differs between the two spheres, in one record so the
 * geometry and its edge labels cannot disagree about the frame or the meridian
 * spacing. The instances live in `coord-sphere-frames.ts`.
 */
export interface CoordSphereSpec {
  dirToIcrs: DirToIcrs;
  /** Meridians drawn, evenly spaced over the full longitude turn. */
  meridianCount: number;
  /** `id` of the SVG `<g>` the edge labels are pooled under. */
  labelGroupId: string;
  lonLabel: (deg: number) => string;
  latLabel: (deg: number) => string;
  /** Sol-distance self-hide, for a frame that only describes the sky *from*
   *  Sol. Absent means the frame is meaningful from anywhere and never fades. */
  fadeWindow?: SolFrameFadeWindow;
}

/** Absolute latitude extent (degrees) a meridian is drawn to: even indices
 *  reach the pole, odd ones stop at the trim, halving the count that runs
 *  into the polar convergence. Shared with coord-sphere-labels so labels
 *  never anchor past the drawn line end. */
export function meridianMaxAbsLatDeg(index: number): number {
  return index % 2 === 0 ? 90 : MERIDIAN_TRIM_LATITUDE_DEG;
}

// Equator gets the fat-line treatment (Line2 + LineMaterial) for genuine
// screen-space width on every platform — `LineBasicMaterial.linewidth`
// silently clamps to 1 in WebGL on Chrome/Win, so it's never reliable.
const EQUATOR_LINEWIDTH_PX = 2.4;

const DARK_COLOUR = 0x6688aa;

// Equator visually marked: stronger opacity than ordinary lat/meridian lines
// so the latitude-zero plane reads as the "spine" of the grid.
const DARK_EQUATOR_OPACITY = 0.7;
const DARK_LINE_OPACITY = 0.45;

/**
 * A toggleable coordinate sphere — a "sky from here" reference grid. Equator +
 * 16 latitude rings every 10° (±10°…±80°) + `spec.meridianCount` meridians
 * evenly spaced over the longitude turn, no pole markers. All baked once
 * through `spec.dirToIcrs`, so the geometry is already in ICRS and the frame's
 * axes stay correctly aimed through any camera move including warp.
 *
 * Per frame the group's position tracks `camera.position` (in local frame) so
 * the sphere is always centred on the observer — the grid lines feel fixed
 * against the sky regardless of where the camera flies.
 *
 * Mono mode swaps to dark, fully-opaque strokes for the chart aesthetic; the
 * equator/line opacity split is preserved by stroke weight rather than alpha,
 * since chart-mode fades aren't on the table. `setOpacityScale` is the one
 * exception — a sphere that must self-hide with distance from Sol keeps its
 * alpha in both styles (`equatorial-sphere.ts`).
 */
export class CoordSphere {
  readonly group: THREE.Group;
  private equatorMaterial: LineMaterial;
  private lineMaterial: THREE.LineBasicMaterial;
  private mono = false;
  private opacityScale = 1;

  constructor(spec: CoordSphereSpec) {
    const { dirToIcrs, meridianCount } = spec;
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

    this.group.add(this.makeFatEquator(dirToIcrs));
    for (const latDeg of LATITUDES_DEG) {
      this.group.add(this.makeLatitudeRing(dirToIcrs, (latDeg * Math.PI) / 180));
    }

    for (let i = 0; i < meridianCount; i++) {
      const lonRad = (i / meridianCount) * Math.PI * 2;
      this.group.add(
        this.makeMeridian(dirToIcrs, lonRad, (meridianMaxAbsLatDeg(i) * Math.PI) / 180),
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

  /** Multiply both stroke alphas by `scale`. Safe to call every frame: the
   *  alphas are plain uniform writes, and the blend-state reconfigure (which
   *  costs a program recompile via `needsUpdate`) only runs when the sphere
   *  crosses into or out of being faded at all. */
  setOpacityScale(scale: number) {
    if (scale === this.opacityScale) return;
    const wasFaded = this.opacityScale < 1;
    this.opacityScale = scale;
    if (wasFaded !== (scale < 1)) this.applyBlendState();
    this.applyOpacity();
  }

  setMonochrome(on: boolean) {
    if (this.mono === on) return;
    this.mono = on;
    this.applyBlendState();
    this.applyOpacity();
  }

  private applyOpacity() {
    this.equatorMaterial.opacity = (this.mono ? 1 : DARK_EQUATOR_OPACITY) * this.opacityScale;
    this.lineMaterial.opacity = (this.mono ? 1 : DARK_LINE_OPACITY) * this.opacityScale;
  }

  // Colour + blend state. Mono mode runs opaque with blending off for the
  // paper aesthetic — but a Sol-distance fade still has to composite, so a
  // scale below 1 keeps alpha blending on in both styles.
  private applyBlendState() {
    const on = this.mono;
    const opaque = on && this.opacityScale >= 1;
    setBuiltinChromeColour(this.equatorMaterial.color, on ? CHART_REFERENCE_INK : DARK_COLOUR, on);
    setBuiltinChromeColour(this.lineMaterial.color, on ? CHART_REFERENCE_INK : DARK_COLOUR, on);
    this.equatorMaterial.transparent = !opaque;
    this.lineMaterial.transparent = !opaque;
    this.lineMaterial.blending = opaque ? THREE.NoBlending : THREE.NormalBlending;
    this.equatorMaterial.needsUpdate = true;
    this.lineMaterial.needsUpdate = true;
  }

  /** Build the latitude-zero equator as a fat Line2 so it stays visually
   *  thicker than the rest of the grid regardless of platform/zoom. The loop is
   *  closed by repeating the first vertex at the end (Line2 is an open
   *  polyline). */
  private makeFatEquator(dirToIcrs: DirToIcrs): Line2 {
    const tmp = new THREE.Vector3();
    const n = EQUATOR_SEGMENTS;
    const positions = new Array(n * 3 + 3);
    let firstX = 0, firstY = 0, firstZ = 0;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      dirToIcrs(t, 0, tmp).multiplyScalar(SPHERE_RADIUS_PC);
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

  private makeLatitudeRing(dirToIcrs: DirToIcrs, latRad: number): THREE.LineLoop {
    const segments = LATITUDE_SEGMENTS;
    const v = new Float32Array(segments * 3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      dirToIcrs(t, latRad, tmp).multiplyScalar(SPHERE_RADIUS_PC);
      v[i * 3 + 0] = tmp.x;
      v[i * 3 + 1] = tmp.y;
      v[i * 3 + 2] = tmp.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(v, 3));
    const loop = new THREE.LineLoop(geom, this.lineMaterial);
    loop.frustumCulled = false;
    loop.renderOrder = -1;
    return loop;
  }

  private makeMeridian(
    dirToIcrs: DirToIcrs,
    lonRad: number,
    latMaxAbsRad: number,
  ): THREE.Line {
    // Meridian sweeps latitude from -latMaxAbsRad to +latMaxAbsRad at fixed
    // longitude. Drawn as a single Line (open polyline) so the south-to-north
    // arc renders without an unwanted closing segment between poles.
    // latMaxAbsRad < π/2 trims the meridian short of the poles.
    const segments = MERIDIAN_SEGMENTS;
    const v = new Float32Array((segments + 1) * 3);
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= segments; i++) {
      const lat = -latMaxAbsRad + (i / segments) * (2 * latMaxAbsRad);
      dirToIcrs(lonRad, lat, tmp).multiplyScalar(SPHERE_RADIUS_PC);
      v[i * 3 + 0] = tmp.x;
      v[i * 3 + 1] = tmp.y;
      v[i * 3 + 2] = tmp.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(v, 3));
    const line = new THREE.Line(geom, this.lineMaterial);
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
