// Local Group wireframe layer (disc + ellipsoid ring outlines).
// See src/client/local-group/README.md.

import * as THREE from 'three';
import type { LgCatalog, LgObject } from './local-group-loader';
import { maxSemiAxisPc } from './local-group-loader';
import { farFieldFadeOpacity } from '../galactic/galactic-fade';
import type { KindContext } from '../kinds/kind-module';
import type { Stellata } from '../stellata';
import { createDistanceGatedLabel, labelHostOf } from '../overlays/distance-gated-label';
import { GAL_TO_ICRS, GALACTIC_CENTRE_PC } from '../galactic/galactic-coords';
import { MIDPLANE_RADIUS_PC } from '../galactic/galactic-disc';
import type {
  ChromeLineMaterial, ChromeLineMaterials,
} from '../chrome-lines/chrome-line-materials';
import { makeOrbitRingSegments, writeRingVerts, type RingSpec } from '../util/orbit-line';
import {
  angularDiameterPx,
  discHitRadiusPx,
  enclosureRadiusPx,
  pickFromCandidates,
  type PickCandidate,
} from '../camera/controls/star-geometry';
import type { HoverHit } from '../hover/hover-types';

type LgPickCandidate = PickCandidate & {
  cameraDistancePc: number;
  lx: number; ly: number; lz: number;
};

export const RING_SEGMENTS = 64;

/** README.md § Runtime layer. The merged buffer sizes off it, and
 *  `buildWireframeSegments` throws rather than truncate if the two
 *  ever disagree. */
export const RINGS_PER_OBJECT = 3;

// Sample grid for the silhouette projection that drives label placement.
// 12 longitudes × 5 mid-latitudes + 2 poles = 62 points per object —
// matches heliopause.ts's grid density (the per-frame cost is one
// vec3 transform per sample, negligible at ~10 labelled objects).
const SAMPLE_N_LONGS = 12;
const SAMPLE_N_LATS = 5;

// Default colour — dim chrome family, slightly cooler than the
// galactic-disc amber so the two reference layers read distinctly when
// both fade in past 5 kpc from Sol.
const DARK_COLOUR = 0x8090a8;
const DARK_BASE_OPACITY = 0.45;

const WIREFRAME_RENDER_ORDER = -1;

/** Stroke opacity at a camera distance from Sol — zero inside the fade's
 *  inner edge, which is the wireframe half of the layer's contribution
 *  test (`../scene/README.md` § Declaring what a layer can put on
 *  screen). The glow half is the brightness verdict. */
export function lgWireframeOpacity(distFromSolPc: number): number {
  return farFieldFadeOpacity(DARK_BASE_OPACITY, distFromSolPc);
}

/**
 * Renderable Local Group wireframe layer. Constructed once from the
 * catalog; per-frame update only writes the group's floating-origin
 * offset and the shared material's opacity.
 */
export class LocalGroupLayer {
  readonly group: THREE.Group;
  readonly objects: LgObject[];
  private readonly stroke: ChromeLineMaterial;
  /** Absolute ICRS pc, indexed `[objectIdx][sampleIdx]`. */
  private readonly absSamples: THREE.Vector3[][];
  private mono = false;
  private readonly tmpFocusableLocal = new THREE.Vector3();

  constructor(catalog: LgCatalog, chromeLines: ChromeLineMaterials) {
    this.objects = catalog.objects;
    this.group = new THREE.Group();
    // Behind the star pass but in front of the cloud layer (which is
    // currently shelved). renderOrder matches GalacticDisc; the two are
    // sibling reference overlays.
    this.group.renderOrder = WIREFRAME_RENDER_ORDER;

    this.stroke = chromeLines.solid(DARK_COLOUR, 0);

    this.absSamples = [];
    for (const obj of this.objects) this.absSamples.push(buildSilhouetteSamples(obj));
    this.group.add(makeOrbitRingSegments(
      buildWireframeSegments(this.objects), RING_SEGMENTS,
      this.stroke.material, WIREFRAME_RENDER_ORDER));
  }

  /** Per-frame update. Call before render.
   *  @param worldOffset absolute-space origin of the renderer frame
   *  @param distFromSolPc ||camera.position + worldOffset|| in absolute pc */
  update(worldOffset: THREE.Vector3, distFromSolPc: number): void {
    if (this.mono) {
      // Chart (mono / paper) mode hides the Local Group wireframes — same
      // policy GalacticDisc + heliopause adopt; chart-mode renders its
      // own paper-aesthetic when chart-mode takes this on, currently
      // it does not.
      this.group.visible = false;
      return;
    }
    this.group.position.copy(worldOffset).negate();
    const opacity = lgWireframeOpacity(distFromSolPc);
    if (opacity <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.stroke.material.opacity = opacity;
  }

  setMonochrome(on: boolean): void {
    this.mono = on;
  }

  /** The lg provider's `localPositionInto` leg. */
  lgLocalPositionInto(idx: number, worldOffset: THREE.Vector3, out: THREE.Vector3): boolean {
    const obj = this.objects[idx];
    if (!obj) return false;
    out.copy(obj.centerAbs).sub(worldOffset);
    return true;
  }

  /** Projected silhouette diameter of an LG object in pixels — the
   *  orientation-independent maxAxis bound the hover pickbox uses. */
  renderedLgSizePx(
    idx: number,
    camera: THREE.PerspectiveCamera,
    worldOffset: THREE.Vector3,
    angularToPx: () => number,
  ): number {
    const obj = this.objects[idx];
    if (!obj) return 0;
    if (!this.lgLocalPositionInto(idx, worldOffset, this.tmpFocusableLocal)) return 0;
    const dCam = Math.max(this.tmpFocusableLocal.distanceTo(camera.position), 1);
    return angularDiameterPx(maxSemiAxisPc(obj), dCam, angularToPx());
  }

  /** Number of silhouette samples for an object — for the label engine. */
  sampleCount(objectIdx: number): number {
    return this.absSamples[objectIdx].length;
  }

  /** Absolute ICRS pc — the label engine subtracts worldOffset itself. */
  getAbsSample(objectIdx: number, sampleIdx: number, out: THREE.Vector3): void {
    out.copy(this.absSamples[objectIdx][sampleIdx]);
  }

  /** Hover-engine entry point for the Local Group layer.
   *
   *  Visibility-only gate per hover Rule 2:
   *  mirrors the renderer's "is this drawn?" predicate exactly — chart
   *  (mono) mode and the distance-fade smoothstep are both encoded by
   *  `group.visible`, which `update()` flips each frame. The pick
   *  short-circuits when the group is hidden.
   *
   *  Per-object pickbox: project `centerAbs - worldOffset` to screen,
   *  estimate the projected silhouette radius as the angular size of the
   *  largest semi-axis (the orientation-independent upper bound — no
   *  direction perpendicular to the line of sight can extend farther
   *  than `maxSemiAxisPc(obj)` from the centroid). That radius is the
   *  object's enclosure, floored at `MIN_DISC_HIT_RADIUS_PX` to match
   *  stars and planets so distant LG objects with sub-pixel angular size
   *  remain hoverable, and again at `pixelThreshold` by the shared
   *  reducer.
   *
   *  Ties between equal enclosures score deepest-inside-its-own-envelope
   *  via the default `pickFromCandidates` scorer (no brightness bias — LG
   *  wireframes have no apparent-magnitude axis). Each candidate carries
   *  its `cameraDistancePc` so the winner hands the ranking numbers and
   *  the distance straight to the returned `HoverHit` — no
   *  re-projection.
   */
  pick(
    camera: THREE.PerspectiveCamera,
    worldOffset: THREE.Vector3,
    rect: DOMRect,
    clientX: number,
    clientY: number,
    pixelThreshold: number,
  ): HoverHit | null {
    if (!this.group.visible) return null;

    const cursorX = clientX - rect.left;
    const cursorY = clientY - rect.top;
    const viewportW = rect.width;
    const viewportH = rect.height;
    const fovYRad = (camera.fov * Math.PI) / 180;
    const pxPerRad = viewportH / fovYRad;
    const camPos = camera.position;
    const v = new THREE.Vector3();
    const candidates: LgPickCandidate[] = [];

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      const lx = obj.centerAbs.x - worldOffset.x;
      const ly = obj.centerAbs.y - worldOffset.y;
      const lz = obj.centerAbs.z - worldOffset.z;

      v.set(lx, ly, lz).project(camera);
      if (v.z < -1 || v.z > 1) continue;

      const dx = lx - camPos.x;
      const dy = ly - camPos.y;
      const dz = lz - camPos.z;
      const cameraDistancePc = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const screenX = (v.x + 1) * 0.5 * viewportW;
      const screenY = (1 - v.y) * 0.5 * viewportH;
      const pxDist = Math.hypot(cursorX - screenX, cursorY - screenY);

      const pxSize = 2 * Math.atan(maxSemiAxisPc(obj) / Math.max(cameraDistancePc, 1)) * pxPerRad;
      const hitRadius = discHitRadiusPx(pxSize);

      if (pxDist > enclosureRadiusPx(hitRadius, pixelThreshold)) continue;
      candidates.push({ idx: i, pxDist, hitRadius, cameraDistancePc, lx, ly, lz });
    }

    const winner = pickFromCandidates(candidates, pixelThreshold);
    if (winner === null) return null;
    return {
      idx: winner.candidate.idx,
      cameraDistancePc: winner.candidate.cameraDistancePc,
      enclosureRadiusPx: winner.enclosureRadiusPx,
      depthScore: winner.depthScore,
      anchorLocal: new THREE.Vector3(winner.candidate.lx, winner.candidate.ly, winner.candidate.lz),
    };
  }

  dispose(): void {
    for (const child of this.group.children) {
      const obj = child as THREE.Line;
      obj.geometry.dispose();
    }
    this.stroke.dispose();
  }
}

/** A disc's axes[2] is its semi-thickness along the normal, not a third
 *  radius, so its rings are one plane at three heights rather than three
 *  planes. README.md § Runtime layer. */
function ringSpecsOf(obj: LgObject): RingSpec[] {
  const [a, b, c] = obj.axes;
  if (obj.kind === 'disc') {
    return [
      { radiusA: a, radiusB: b, plane: 'xy', offset: 0 },
      { radiusA: a, radiusB: b, plane: 'xy', offset: c },
      { radiusA: a, radiusB: b, plane: 'xy', offset: -c },
    ];
  }
  return [
    { radiusA: a, radiusB: b, plane: 'xy', offset: 0 },
    { radiusA: a, radiusB: c, plane: 'xz', offset: 0 },
    { radiusA: b, radiusB: c, plane: 'yz', offset: 0 },
  ];
}

/** Every object's rings as one vertex buffer in absolute ICRS pc, ring
 *  after ring — README.md § Runtime layer. */
function buildWireframeSegments(objects: readonly LgObject[]): Float32Array {
  const out = new Float32Array(objects.length * RINGS_PER_OBJECT * RING_SEGMENTS * 3);
  let at = 0;
  for (const obj of objects) {
    const toAbsIcrs = (v: THREE.Vector3): void => {
      v.applyQuaternion(obj.quat).add(obj.centerAbs);
    };
    for (const spec of ringSpecsOf(obj)) {
      at = writeRingVerts(spec, RING_SEGMENTS, toAbsIcrs, out, at);
    }
  }
  if (at !== out.length) {
    throw new Error(`LG wireframe filled ${at} of ${out.length} floats`);
  }
  return out;
}

/** Precompute silhouette sample points in absolute ICRS pc for one
 *  object — enough density that the label engine's support-point
 *  search lands on a tight bbox curve as the camera orbits. Same grid
 *  shape as heliopause.ts's: 12 longitudes × 5 mid-latitudes + 2 poles.
 *  Cost is 62 vec3 transforms once at construction. */
function buildSilhouetteSamples(obj: LgObject): THREE.Vector3[] {
  const samples: THREE.Vector3[] = [];
  const a = obj.axes[0];
  const b = obj.axes[1];
  const c = obj.axes[2];
  const push = (lx: number, ly: number, lz: number): void => {
    const v = new THREE.Vector3(lx, ly, lz)
      .applyQuaternion(obj.quat)
      .add(obj.centerAbs);
    samples.push(v);
  };
  for (let i = 0; i < SAMPLE_N_LATS; i++) {
    const theta = ((i + 0.5) / SAMPLE_N_LATS) * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j < SAMPLE_N_LONGS; j++) {
      const phi = (j / SAMPLE_N_LONGS) * 2 * Math.PI;
      push(a * sinT * Math.cos(phi), b * sinT * Math.sin(phi), c * cosT);
    }
  }
  push(0, 0, c);
  push(0, 0, -c);
  return samples;
}

// ============================================================
// Label policy — apparent-size ranking
//
// Single uniform rule for every label (MW + every LG object): each
// frame, rank candidates by apparent pixel size and reveal the top N
// (with a sub-pixel floor). One global exception: when the camera sits
// inside the MW disc (||cam - GC|| < mwInsideDiscPc), suppress *every*
// label — extra-MW objects you can see from inside the disc would be
// labelling things the user isn't really looking at yet.
// ============================================================

/** Disc-rim silhouette samples for the MW label: 32 points around the
 *  15 kpc midplane ring (galactic-disc.ts's MIDPLANE_RADIUS_PC). */
const MW_RIM_SEGMENTS = 32;

// Bottom-right SVG anchor direction (1, 1)/√2 in CSS y-down coords.
// Matches heliopause's choice so the label-anchor family reads
// consistently across context overlays.
const LABEL_DIR = { x: Math.SQRT1_2, y: Math.SQRT1_2 };

// Constant 10 px gap from silhouette support point to label anchor —
// same as planet labels + heliopause for visual continuity.
const LABEL_OFFSET_PX = 10;

// Settles in ~4-5 frames at 60 fps (~70 ms).
const LABEL_LERP = 0.25;

/** One candidate in the per-frame ranking. */
export interface LabelCandidate {
  /** Stable string id — `'mw'` for the Milky Way, `obj.id` for each LG object. */
  id: string;
  /** Absolute ICRS centroid in parsecs. */
  centerAbs: THREE.Vector3;
  /** Longest semi-axis in parsecs — drives the angular-size estimate. */
  maxAxis: number;
}

/** Inputs to the pure ranking helper. */
export interface RankingParams {
  /** `camera.position + worldOffset`, ICRS pc. */
  cameraAbs: THREE.Vector3;
  /** Absolute ICRS pc — pivot of the inside-MW guard. */
  galacticCentreAbs: THREE.Vector3;
  /** Floating-origin offset — subtracted from each candidate's centerAbs
   *  to get its position in the renderer's local world frame. */
  worldOffset: THREE.Vector3;
  /** renderer-local-world → camera-space. */
  matrixWorldInverse: THREE.Matrix4;
  /** camera-space → NDC. */
  projectionMatrix: THREE.Matrix4;
  /** Vertical field of view. */
  fovDeg: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  /** Max number of labels visible at once. */
  topN: number;
  /** Apparent-size floor. */
  minPixelSize: number;
  /** Camera-to-GC distance (pc) below which every label is suppressed. */
  mwInsideDiscPc: number;
}

// Tunable runtime state. The default values match the v1 visual; the
// Deep-field debug panel exposes setters that mutate these and the
// per-frame ranking handler re-reads them each frame.
export const DEFAULT_TOP_N = 8;
export const DEFAULT_MIN_PIXEL_SIZE_PX = 2.0;
export const DEFAULT_MW_INSIDE_DISC_PC = 10_000;

let topN = DEFAULT_TOP_N;
let minPixelSize = DEFAULT_MIN_PIXEL_SIZE_PX;
let mwInsideDiscPc = DEFAULT_MW_INSIDE_DISC_PC;

export const getTopN = (): number => topN;
export const setTopN = (n: number): void => { topN = n; };
export const getMinPixelSize = (): number => minPixelSize;
export const setMinPixelSize = (px: number): void => { minPixelSize = px; };
export const getMwInsideDiscPc = (): number => mwInsideDiscPc;
export const setMwInsideDiscPc = (pc: number): void => { mwInsideDiscPc = pc; };

// Scratch for the ranking helper. Lives at module scope so the per-frame
// ranking pass allocates zero. One frame handler serves every label
// family (§ Label engine), so there is no aliasing concern — a second
// concurrent caller would need its own buffers.
const tmpProj = /*@__PURE__*/ new THREE.Vector3();
// The top-N survivors, descending, as two parallel arrays rather than
// object literals. Grown on demand and never shrunk: `topN` is a live
// debug slider, so the buffer sizes to the largest cap the session asks
// for and every later frame reuses it.
const rankedIds: string[] = [];
const rankedPx: number[] = [];

/** Fill `out` with the IDs whose labels should be visible this frame.
 *  Filter order, the ranking rule and the zero-allocation contract are
 *  in README.md. */
export function computeVisibleLabelsInto(
  candidates: readonly LabelCandidate[],
  params: RankingParams,
  out: Set<string>,
): void {
  out.clear();
  const dxGc = params.cameraAbs.x - params.galacticCentreAbs.x;
  const dyGc = params.cameraAbs.y - params.galacticCentreAbs.y;
  const dzGc = params.cameraAbs.z - params.galacticCentreAbs.z;
  const camToGc = Math.sqrt(dxGc * dxGc + dyGc * dyGc + dzGc * dzGc);
  if (camToGc < params.mwInsideDiscPc) return;

  const cap = Math.min(Math.max(params.topN, 0), candidates.length);
  if (cap === 0) return;
  while (rankedIds.length < cap) { rankedIds.push(''); rankedPx.push(0); }

  const pxPerRad = params.viewportHeightPx / ((params.fovDeg * Math.PI) / 180);
  let count = 0;
  for (const cand of candidates) {
    // Move candidate to the renderer's local-world frame (subtract
    // worldOffset) so the camera's matrices apply.
    tmpProj.set(
      cand.centerAbs.x - params.worldOffset.x,
      cand.centerAbs.y - params.worldOffset.y,
      cand.centerAbs.z - params.worldOffset.z,
    );
    tmpProj.applyMatrix4(params.matrixWorldInverse);
    // Camera looks down -Z: anything at z ≥ 0 is behind the camera.
    if (tmpProj.z >= 0) continue;
    const camToObj = tmpProj.length();
    const angSizeRad = 2 * Math.atan(cand.maxAxis / Math.max(camToObj, 1));
    const pxSize = angSizeRad * pxPerRad;
    if (pxSize < params.minPixelSize) continue;
    // Project to NDC, convert to viewport pixel coords.
    tmpProj.applyMatrix4(params.projectionMatrix);
    const screenX = (tmpProj.x + 1) * 0.5 * params.viewportWidthPx;
    const screenY = (1 - tmpProj.y) * 0.5 * params.viewportHeightPx;
    // Silhouette bounding-circle overlap with the viewport. Padding by
    // half pxSize so a big object with off-screen centroid still
    // counts when its edge crosses the screen.
    const r = pxSize * 0.5;
    if (screenX + r < 0 || screenX - r > params.viewportWidthPx) continue;
    if (screenY + r < 0 || screenY - r > params.viewportHeightPx) continue;

    // Insert into the descending top-N, dropping the smallest once full.
    // The strict `>` is what preserves the stable sort's tie-break: an
    // equal pxSize stops the shift and lands after the incumbent.
    if (count === cap && pxSize <= rankedPx[cap - 1]) continue;
    let i = count < cap ? count : cap - 1;
    while (i > 0 && pxSize > rankedPx[i - 1]) {
      rankedPx[i] = rankedPx[i - 1];
      rankedIds[i] = rankedIds[i - 1];
      i--;
    }
    rankedPx[i] = pxSize;
    rankedIds[i] = cand.id;
    if (count < cap) count++;
  }
  for (let i = 0; i < count; i++) out.add(rankedIds[i]);
}

/** What the shared ranking pass + both label families read per frame —
 *  satisfied by `KindContext` directly (the lg module's labels leg) and
 *  built from `Stellata` for the MW label, which is wired outside the
 *  module (the Milky Way is not an lg catalog object). */
export type LgLabelHost = Pick<
  KindContext,
  'camera' | 'onFrame' | 'occluders' | 'getWorldOffset' | 'getMonochrome'
  | 'detailPermits'
>;

function lgLabelHostOf(stellata: Stellata): LgLabelHost {
  return {
    ...labelHostOf(stellata),
    getWorldOffset: () => stellata.getWorldOffset(),
    getMonochrome: () => stellata.getMonochrome(),
    detailPermits: (id) => stellata.detailPermits(id),
  };
}

// Runtime state for the per-frame ranking. The ranking handler runs
// before any label engine's predicate (because we register it on the
// first createMilkyWayLabel / createLocalGroupLabels call, ahead of
// the per-label handlers), and each label's predicate just queries
// `visibleLabelIds.has(...)`.
const candidates: LabelCandidate[] = [];
const visibleLabelIds = new Set<string>();
const tmpCamAbs = new THREE.Vector3();
let rankingHolders = 0;
let stopRanking: (() => void) | null = null;

/** The last release unsubscribes the shared pass and clears the verdict
 *  — skip it and a re-created host reads a disposed host's
 *  `visibleLabelIds` forever. */
function acquireRankingHandler(host: LgLabelHost): () => void {
  rankingHolders++;
  if (!stopRanking) {
    // Built once per subscription instead of as a literal per frame, so
    // the pass allocates nothing. Every field except the first two is
    // refreshed from the host below before each ranking call — the seeds
    // here exist only to satisfy the type and are never read.
    const params: RankingParams = {
      cameraAbs: tmpCamAbs,
      galacticCentreAbs: GALACTIC_CENTRE_PC,
      worldOffset: host.getWorldOffset(),
      matrixWorldInverse: host.camera.matrixWorldInverse,
      projectionMatrix: host.camera.projectionMatrix,
      fovDeg: 0,
      viewportWidthPx: 0,
      viewportHeightPx: 0,
      topN: 0,
      minPixelSize: 0,
      mwInsideDiscPc: 0,
    };
    stopRanking = host.onFrame(() => {
      if (host.getMonochrome()) {
        visibleLabelIds.clear();
        return;
      }
      const c = host.camera.position;
      const w = host.getWorldOffset();
      tmpCamAbs.set(c.x + w.x, c.y + w.y, c.z + w.z);
      // Make sure the camera's matrices reflect this frame's camera
      // pose — controls.update() mutates camera.position but doesn't
      // propagate to matrixWorld/matrixWorldInverse. The render call
      // will refresh them anyway, but our ranking runs before render
      // each frame (it's a 'frame' event handler), so we have to flush
      // explicitly or we read last-frame's projection.
      host.camera.updateMatrixWorld();
      params.worldOffset = w;
      params.matrixWorldInverse = host.camera.matrixWorldInverse;
      params.projectionMatrix = host.camera.projectionMatrix;
      params.fovDeg = host.camera.fov;
      params.viewportWidthPx = window.innerWidth;
      params.viewportHeightPx = window.innerHeight;
      params.topN = topN;
      params.minPixelSize = minPixelSize;
      params.mwInsideDiscPc = mwInsideDiscPc;
      computeVisibleLabelsInto(candidates, params, visibleLabelIds);
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--rankingHolders > 0) return;
    stopRanking?.();
    stopRanking = null;
    visibleLabelIds.clear();
  };
}

export function createMilkyWayLabel(stellata: Stellata): void {
  const host = lgLabelHostOf(stellata);
  acquireRankingHandler(host);
  candidates.push({
    id: 'mw',
    centerAbs: GALACTIC_CENTRE_PC.clone(),
    maxAxis: MIDPLANE_RADIUS_PC,
  });
  const rimSamplesAbs = buildMwRimSamples();
  createDistanceGatedLabel(host, {
    elementId: 'mw-label',
    sampleCount: rimSamplesAbs.length,
    getWorldSample: (i, out) => out.copy(rimSamplesAbs[i]).sub(host.getWorldOffset()),
    visible: () => visibleLabelIds.has('mw') && host.detailPermits('mwLabel'),
    labelDir: LABEL_DIR,
    offsetPx: LABEL_OFFSET_PX,
    lerp: LABEL_LERP,
  });
}

/** Mirrors galactic-disc.ts's midplane ring construction; absolute
 *  ICRS pc. */
function buildMwRimSamples(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < MW_RIM_SEGMENTS; i++) {
    const t = (i / MW_RIM_SEGMENTS) * Math.PI * 2;
    const v = new THREE.Vector3(
      MIDPLANE_RADIUS_PC * Math.cos(t),
      MIDPLANE_RADIUS_PC * Math.sin(t),
      0,
    );
    v.applyMatrix4(GAL_TO_ICRS).add(GALACTIC_CENTRE_PC);
    out.push(v);
  }
  return out;
}

/** Mount per-object SVG labels for every LG member. Each label
 *  becomes a candidate in the global apparent-size ranking; the
 *  per-label predicate is just `visibleLabelIds.has(obj.id)`. Called
 *  from the lg module's `labels()` leg; the returned teardown removes
 *  the minted nodes, frame handlers, and ranking candidates. */
export function createLocalGroupLabels(
  host: LgLabelHost,
  layer: LocalGroupLayer,
): () => void {
  const group = document.getElementById('lg-labels') as unknown as SVGGElement | null;
  if (!group) return () => {};
  // Acquired before the per-label engines subscribe, so the ranking pass
  // runs ahead of every predicate that queries its verdict.
  const releaseRanking = acquireRankingHandler(host);
  const teardowns: (() => void)[] = [];
  const texts: SVGTextElement[] = [];
  const ownCandidates: LabelCandidate[] = [];
  for (let i = 0; i < layer.objects.length; i++) {
    const obj = layer.objects[i];
    const candidate: LabelCandidate = {
      id: obj.id,
      centerAbs: obj.centerAbs.clone(),
      maxAxis: maxSemiAxisPc(obj),
    };
    candidates.push(candidate);
    ownCandidates.push(candidate);
    const elementId = `lg-${obj.id}-label`;
    // Mint the SVG <text> element. innerHTML escape is unnecessary
    // since both id and name come from our own build-time output
    // (object names are real catalogue entries, no user input).
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('id', elementId);
    text.setAttribute('class', 'lg-label');
    text.setAttribute('text-anchor', 'start');
    text.setAttribute('dominant-baseline', 'hanging');
    text.textContent = obj.name;
    group.appendChild(text);
    texts.push(text);

    const idx = i;
    const id = obj.id;
    teardowns.push(createDistanceGatedLabel(host, {
      elementId,
      sampleCount: layer.sampleCount(idx),
      getWorldSample: (j, out) => {
        layer.getAbsSample(idx, j, out);
        out.sub(host.getWorldOffset());
      },
      visible: () => visibleLabelIds.has(id) && host.detailPermits('lgObjectLabels'),
      labelDir: LABEL_DIR,
      offsetPx: LABEL_OFFSET_PX,
      lerp: LABEL_LERP,
    }));
  }
  return () => {
    for (const stop of teardowns) stop();
    for (const text of texts) text.remove();
    for (const candidate of ownCandidates) {
      const at = candidates.indexOf(candidate);
      if (at >= 0) candidates.splice(at, 1);
    }
    releaseRanking();
  };
}
