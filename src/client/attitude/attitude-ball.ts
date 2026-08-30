// The 8-ball itself: an FDAI-style equirectangular grid painted to a canvas,
// wrapped on a sphere, and rendered by a small standalone WebGL renderer.

import * as THREE from 'three';
import { ballBasisInto, type ReferenceFrame } from './attitude-pure';

const TEX_W = 4096;
const TEX_H = 2048;

const LIGHT = '#e6edf7';
const DARK = '#070912';
const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const SOLID_STEP_DEG = 30;
const TICK_STEP_DEG = 5;
// The light belt runs south of the equator, so the dark hemisphere starts
// here rather than at 0° and every marking above it is drawn in dark ink.
const BELT_DEG = 3;

const PX_PER_DEG = TEX_W / 360;
const lonToX = (deg: number) => TEX_W * (deg / 360 + 0.5);
const latToY = (deg: number) => TEX_H * (0.5 - deg / 180);

// The ball's model matrix is a reflection, so the texture reads back-to-front
// in longitude unless every glyph is drawn mirrored to cancel it.
function mirroredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function segment(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Solid graticule every 30°, and between them a track of perpendicular ticks
 *  every 5° on the 15° offsets — the FDAI's way of carrying a scale without
 *  drawing a line for it. */
function paintGraticule(ctx: CanvasRenderingContext2D) {
  const tick = 1.4 * PX_PER_DEG;

  ctx.lineWidth = 3.2;
  for (let lat = -60; lat <= 60; lat += SOLID_STEP_DEG) {
    if (lat === 0) continue;
    segment(ctx, 0, latToY(lat), TEX_W, latToY(lat));
  }
  for (let lon = -180; lon <= 180; lon += SOLID_STEP_DEG) {
    segment(ctx, lonToX(lon), 0, lonToX(lon), TEX_H);
  }

  ctx.lineWidth = 2.6;
  for (let lat = -75; lat <= 75; lat += SOLID_STEP_DEG) {
    const y = latToY(lat);
    for (let lon = -180; lon < 180; lon += TICK_STEP_DEG) {
      const x = lonToX(lon);
      segment(ctx, x, y - tick, x, y + tick);
    }
  }
  for (let lon = -165; lon <= 165; lon += SOLID_STEP_DEG) {
    const x = lonToX(lon);
    for (let lat = -75; lat <= 75; lat += TICK_STEP_DEG) {
      if (lat === 0) continue;
      const y = latToY(lat);
      segment(ctx, x - tick, y, x + tick, y);
    }
  }
}

/** The equator carries its own fine scale: a solid line on the light belt with
 *  a tick per degree, stepped up every 5° and 10° so the comb stays readable. */
function paintEquator(ctx: CanvasRenderingContext2D) {
  const y = latToY(0);
  ctx.lineWidth = 1.6;
  for (let lon = -180; lon < 180; lon += 1) {
    const len = (lon % 10 === 0 ? 2.4 : lon % 5 === 0 ? 1.7 : 1.0) * PX_PER_DEG;
    const x = lonToX(lon);
    segment(ctx, x, y, x, y + len);
  }
  ctx.lineWidth = 4;
  segment(ctx, 0, y, TEX_W, y);
}

function paintLabels(
  ctx: CanvasRenderingContext2D,
  frame: ReferenceFrame,
  north: boolean,
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `600 ${2.1 * PX_PER_DEG}px ${FONT}`;
  for (let lon = -180; lon < 180; lon += SOLID_STEP_DEG) {
    const label = frame.formatLonTick((lon * Math.PI) / 180);
    mirroredText(ctx, label, lonToX(lon + 15), latToY(north ? 8 : -10));
  }

  ctx.font = `600 ${1.9 * PX_PER_DEG}px ${FONT}`;
  for (const lat of north ? [30, 60] : [-30, -60]) {
    for (const lon of [-90, 90]) {
      const sign = lat > 0 ? '+' : '−';
      mirroredText(ctx, `${sign}${Math.abs(lat)}`, lonToX(lon + 15), latToY(lat + 4));
    }
  }
}

export function buildBallTexture(frame: ReferenceFrame): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  const belt = latToY(-BELT_DEG);

  ctx.fillStyle = LIGHT;
  ctx.fillRect(0, 0, TEX_W, belt);
  ctx.fillStyle = DARK;
  ctx.fillRect(0, belt, TEX_W, TEX_H - belt);

  for (const north of [true, false]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, north ? 0 : belt, TEX_W, north ? belt : TEX_H - belt);
    ctx.clip();
    ctx.strokeStyle = ctx.fillStyle = north ? DARK : LIGHT;
    paintGraticule(ctx);
    if (north) paintEquator(ctx);
    paintLabels(ctx, frame, north);
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

export interface AttitudeBall {
  canvas: HTMLCanvasElement;
  setFrame(frame: ReferenceFrame): void;
  render(camera: THREE.Camera, frame: ReferenceFrame): void;
  dispose(): void;
}

export function createAttitudeBall(sizePx: number): AttitudeBall {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(sizePx, sizePx, false);
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const view = new THREE.PerspectiveCamera(20, 1, 0.1, 20);
  view.position.set(0, 0, 6);

  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const canvas = renderer.domElement;
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;

  return {
    canvas,
    setFrame(frame) {
      material.map?.dispose();
      material.map = buildBallTexture(frame);
      material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      material.needsUpdate = true;
    },
    render(camera, frame) {
      ballBasisInto(mesh.matrix, camera, frame);
      mesh.matrixWorldNeedsUpdate = true;
      renderer.render(scene, view);
    },
    dispose() {
      material.map?.dispose();
      material.dispose();
      mesh.geometry.dispose();
      renderer.dispose();
    },
  };
}
