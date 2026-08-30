// The 8-ball itself: an equirectangular grid painted to a canvas, wrapped on a
// sphere, and rendered by a small standalone WebGL renderer of its own.

import * as THREE from 'three';
import { ballBasisInto, type ReferenceFrame } from './attitude-pure';

const TEX_W = 2048;
const TEX_H = 1024;

const NORTH_FILL = '#c3cedb';
const SOUTH_FILL = '#20262e';
const NORTH_INK = '#3c4a59';
const SOUTH_INK = '#94a2b1';
const EQUATOR_INK = '#e8a93c';

const PARALLEL_STEP_DEG = 10;
const MERIDIAN_STEP_DEG = 30;
const LABEL_STEP_DEG = 30;

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

function paintHemisphere(
  ctx: CanvasRenderingContext2D,
  frame: ReferenceFrame,
  north: boolean,
) {
  const ink = north ? NORTH_INK : SOUTH_INK;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, north ? 0 : TEX_H / 2, TEX_W, TEX_H / 2);
  ctx.clip();

  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  for (let lat = -80; lat <= 80; lat += PARALLEL_STEP_DEG) {
    if (lat === 0) continue;
    ctx.lineWidth = lat % MERIDIAN_STEP_DEG === 0 ? 3 : 1.5;
    ctx.globalAlpha = lat % MERIDIAN_STEP_DEG === 0 ? 0.85 : 0.4;
    ctx.beginPath();
    ctx.moveTo(0, latToY(lat));
    ctx.lineTo(TEX_W, latToY(lat));
    ctx.stroke();
  }

  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.8;
  for (let lon = -180; lon <= 180; lon += MERIDIAN_STEP_DEG) {
    ctx.beginPath();
    ctx.moveTo(lonToX(lon), 0);
    ctx.lineTo(lonToX(lon), TEX_H);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  for (let lon = -180; lon < 180; lon += LABEL_STEP_DEG) {
    const label = frame.formatLonTick((lon * Math.PI) / 180);
    mirroredText(ctx, label, lonToX(lon), latToY(north ? 7 : -7));
  }

  ctx.font = '600 30px ui-sans-serif, system-ui, sans-serif';
  for (const lat of north ? [30, 60] : [-30, -60]) {
    for (const lon of [-90, 90]) {
      const sign = lat > 0 ? '+' : '−';
      mirroredText(ctx, `${sign}${Math.abs(lat)}`, lonToX(lon), latToY(lat) - 26);
    }
  }

  ctx.font = '700 64px ui-sans-serif, system-ui, sans-serif';
  mirroredText(ctx, north ? 'N' : 'S', lonToX(0), latToY(north ? 82 : -82));

  ctx.restore();
}

export function buildBallTexture(frame: ReferenceFrame): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = NORTH_FILL;
  ctx.fillRect(0, 0, TEX_W, TEX_H / 2);
  ctx.fillStyle = SOUTH_FILL;
  ctx.fillRect(0, TEX_H / 2, TEX_W, TEX_H / 2);

  paintHemisphere(ctx, frame, true);
  paintHemisphere(ctx, frame, false);

  ctx.strokeStyle = EQUATOR_INK;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, TEX_H / 2);
  ctx.lineTo(TEX_W, TEX_H / 2);
  ctx.stroke();

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
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), material);
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
