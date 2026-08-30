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
const TRACK_STEP_DEG = 5;
const SCALE_STEP_DEG = 2;

const PX_PER_DEG = TEX_W / 360;
const deg = (d: number) => d * PX_PER_DEG;
const lonToX = (d: number) => TEX_W * (d / 360 + 0.5);
const latToY = (d: number) => TEX_H * (0.5 - d / 180);

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

/** Solid graticule every 30°, and on the 15° offsets **no line at all** — a
 *  track of ticks every 5°, perpendicular to the line they stand in for. Where
 *  two tracks cross they read as the FDAI's little `+`. The equator and the
 *  prime meridian are omitted here; both carry their own scale. */
function paintGraticule(ctx: CanvasRenderingContext2D) {
  const tick = deg(1.4);

  ctx.lineWidth = 3.2;
  for (let lat = -60; lat <= 60; lat += SOLID_STEP_DEG) {
    if (lat === 0) continue;
    segment(ctx, 0, latToY(lat), TEX_W, latToY(lat));
  }
  for (let lon = -180; lon <= 180; lon += SOLID_STEP_DEG) {
    if (lon === 0) continue;
    segment(ctx, lonToX(lon), 0, lonToX(lon), TEX_H);
  }

  ctx.lineWidth = 2.6;
  for (let lat = -75; lat <= 75; lat += SOLID_STEP_DEG) {
    const y = latToY(lat);
    for (let lon = -180; lon < 180; lon += TRACK_STEP_DEG) {
      const x = lonToX(lon);
      segment(ctx, x, y - tick, x, y + tick);
    }
  }
  for (let lon = -165; lon <= 165; lon += SOLID_STEP_DEG) {
    const x = lonToX(lon);
    for (let lat = -75; lat <= 75; lat += TRACK_STEP_DEG) {
      if (lat === 0) continue;
      const y = latToY(lat);
      segment(ctx, x - tick, y, x + tick, y);
    }
  }
}

/** Ticks along the prime meridian, in whichever ink the hemisphere needs. The
 *  flanking rails themselves are painted unclipped by `paintPrimeRails`. */
function paintPrimeTicks(ctx: CanvasRenderingContext2D) {
  const x = lonToX(0);
  ctx.lineWidth = 2.4;
  for (let lat = -88; lat <= 88; lat += SCALE_STEP_DEG) {
    const len = deg(lat % 10 === 0 ? 2.1 : 1.3);
    const y = latToY(lat);
    segment(ctx, x - len, y, x + len, y);
  }
}

/** The prime meridian's rails: a dark line flanked by two light ones of equal
 *  thickness. Drawn unclipped, so each hemisphere shows the half that contrasts
 *  — a plain dark line across the light side, a split light rail across the
 *  dark one. */
function paintPrimeRails(ctx: CanvasRenderingContext2D) {
  const x = lonToX(0);
  ctx.strokeStyle = LIGHT;
  ctx.lineWidth = deg(1.35);
  segment(ctx, x, 0, x, TEX_H);
  ctx.strokeStyle = DARK;
  ctx.lineWidth = deg(0.45);
  segment(ctx, x, 0, x, TEX_H);
}

/** The equator needs no line of its own — it is the seam between the two
 *  hemispheres. It carries a scale instead, ticking north into the light. */
function paintEquatorTicks(ctx: CanvasRenderingContext2D) {
  const y = latToY(0);
  ctx.lineWidth = 2.4;
  for (let lon = -180; lon < 180; lon += SCALE_STEP_DEG) {
    const len = deg(lon % 10 === 0 ? 2.1 : 1.3);
    const x = lonToX(lon);
    segment(ctx, x, y, x, y - len);
  }
}

/** FDAI numerals: tens of degrees with the trailing zero dropped, one size
 *  throughout. Latitude drops its sign too — the hemisphere's own colour is
 *  what says south, which is the whole point of a two-tone ball. */
function paintLabels(ctx: CanvasRenderingContext2D, north: boolean) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${deg(7.5)}px ${FONT}`;

  for (let lon = -180; lon < 180; lon += SOLID_STEP_DEG) {
    const tens = Math.round((((lon % 360) + 360) % 360) / 10);
    mirroredText(ctx, String(tens), lonToX(lon + 7), latToY(north ? 10 : -10));
  }

  for (const lat of north ? [30, 60] : [-30, -60]) {
    const tens = Math.abs(lat) / 10;
    for (const lon of [0, 90, 180, 270]) {
      mirroredText(
        ctx,
        String(tens),
        lonToX(lon + 7),
        latToY(lat - Math.sign(lat) * 6),
      );
    }
  }
}

export function buildBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  const equator = latToY(0);

  ctx.fillStyle = LIGHT;
  ctx.fillRect(0, 0, TEX_W, equator);
  ctx.fillStyle = DARK;
  ctx.fillRect(0, equator, TEX_W, TEX_H - equator);

  for (const north of [true, false]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, north ? 0 : equator, TEX_W, north ? equator : TEX_H - equator);
    ctx.clip();
    ctx.strokeStyle = ctx.fillStyle = north ? DARK : LIGHT;
    paintGraticule(ctx);
    paintPrimeTicks(ctx);
    if (north) paintEquatorTicks(ctx);
    paintLabels(ctx, north);
    ctx.restore();
  }
  paintPrimeRails(ctx);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

export interface AttitudeBall {
  canvas: HTMLCanvasElement;
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

  const map = buildBallTexture();
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), material);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const canvas = renderer.domElement;
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;

  return {
    canvas,
    render(camera, frame) {
      ballBasisInto(mesh.matrix, camera, frame);
      mesh.matrixWorldNeedsUpdate = true;
      renderer.render(scene, view);
    },
    dispose() {
      map.dispose();
      material.dispose();
      mesh.geometry.dispose();
      renderer.dispose();
    },
  };
}
