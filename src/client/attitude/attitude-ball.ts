// The 8-ball itself: an FDAI-style equirectangular grid painted to a canvas,
// wrapped on a sphere, and rendered by a small standalone WebGL renderer.

import * as THREE from 'three';
import { ballBasisInto, type ReferenceFrame } from './attitude-pure';

// The ball spans `BALL_PX` CSS pixels at a device ratio of at most 2, so its
// centre resolves under 3 texels per degree. This is still ~2x that; every
// stroke below is measured in degrees so the size stays a free parameter.
const TEX_W = 2048;
const TEX_H = 1024;

const LIGHT = '#e6edf7';
const DARK = '#070912';
const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const SOLID_STEP_DEG = 30;
const TRACK_STEP_DEG = 5;
const SCALE_STEP_DEG = 2;

const GRATICULE_W_DEG = 0.281;
const TRACK_TICK_W_DEG = 0.229;
const SCALE_TICK_W_DEG = 0.211;

const PX_PER_DEG = TEX_W / 360;
const deg = (d: number) => d * PX_PER_DEG;
const lonToX = (d: number) => TEX_W * (d / 360 + 0.5);
const latToY = (d: number) => TEX_H * (0.5 - d / 180);

/** Undoes the equirectangular squeeze along a parallel: a degree of longitude
 *  is only `cos(lat)` of arc, so anything measured east-west has to widen by
 *  this to hold a constant size **on the sphere**. That is how the real ball
 *  was painted — the meridian rail is a solid reference at any attitude, so it
 *  must not thin to nothing where the crew most needs it. Clamped near 78°,
 *  past which the correction diverges. */
const lonStretch = (lat: number) =>
  1 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));

const RIBBON_STEP_DEG = 2;

/** A meridian drawn as a filled ribbon rather than a stroke, so its width can
 *  follow `lonStretch` up the sphere instead of tapering away with the
 *  converging meridians. */
function meridianRibbon(
  ctx: CanvasRenderingContext2D,
  lonDeg: number,
  halfWidthPx: number,
) {
  const x = lonToX(lonDeg);
  const half = (lat: number) => halfWidthPx * lonStretch(lat);
  ctx.beginPath();
  ctx.moveTo(x - half(90), latToY(90));
  for (let lat = 90 - RIBBON_STEP_DEG; lat >= -90; lat -= RIBBON_STEP_DEG) {
    ctx.lineTo(x - half(lat), latToY(lat));
  }
  for (let lat = -90; lat <= 90; lat += RIBBON_STEP_DEG) {
    ctx.lineTo(x + half(lat), latToY(lat));
  }
  ctx.closePath();
  ctx.fill();
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

  ctx.lineWidth = deg(GRATICULE_W_DEG);
  for (let lat = -60; lat <= 60; lat += SOLID_STEP_DEG) {
    if (lat === 0) continue;
    segment(ctx, 0, latToY(lat), TEX_W, latToY(lat));
  }
  for (let lon = -180; lon <= 180; lon += SOLID_STEP_DEG) {
    if (lon === 0) continue;
    meridianRibbon(ctx, lon, deg(GRATICULE_W_DEG) / 2);
  }

  for (let lat = -75; lat <= 75; lat += SOLID_STEP_DEG) {
    const y = latToY(lat);
    // A vertical tick's *thickness* runs east-west, so it thins toward the
    // poles unless it widens along with everything else.
    ctx.lineWidth = deg(TRACK_TICK_W_DEG) * lonStretch(lat);
    for (let lon = -180; lon < 180; lon += TRACK_STEP_DEG) {
      const x = lonToX(lon);
      segment(ctx, x, y - tick, x, y + tick);
    }
  }
  ctx.lineWidth = deg(TRACK_TICK_W_DEG);
  for (let lon = -165; lon <= 165; lon += SOLID_STEP_DEG) {
    const x = lonToX(lon);
    for (let lat = -75; lat <= 75; lat += TRACK_STEP_DEG) {
      if (lat === 0) continue;
      // A horizontal tick's *length* runs east-west, so it shortens instead.
      const half = tick * lonStretch(lat);
      const y = latToY(lat);
      segment(ctx, x - half, y, x + half, y);
    }
  }
}

/** The prime meridian's painted band: five equal stripes — dark, light, dark,
 *  light, dark — reading outward from the centre line, matching the rail the
 *  real ball carries. Drawn widest-first, each stroke over the last. */
const PRIME_BANDS_DEG = [2.5, 1.5, 0.5];
const PRIME_HALF_DEG = PRIME_BANDS_DEG[0] / 2;

/** Ticks flanking the prime meridian, in whichever ink the hemisphere needs.
 *  They start outside the painted band rather than crossing it. */
function paintPrimeTicks(ctx: CanvasRenderingContext2D) {
  const x = lonToX(0);
  ctx.lineWidth = deg(SCALE_TICK_W_DEG);
  for (let lat = -88; lat <= 88; lat += SCALE_STEP_DEG) {
    const stretch = lonStretch(lat);
    const gap = deg(PRIME_HALF_DEG) * stretch;
    const len = deg(lat % 10 === 0 ? 2.1 : 1.3) * stretch;
    const y = latToY(lat);
    segment(ctx, x - gap, y, x - gap - len, y);
    segment(ctx, x + gap, y, x + gap + len, y);
  }
}

/** The prime meridian's rails, painted unclipped so each hemisphere shows
 *  whichever bands contrast against it. */
function paintPrimeRails(ctx: CanvasRenderingContext2D) {
  PRIME_BANDS_DEG.forEach((width, i) => {
    ctx.fillStyle = i % 2 === 0 ? DARK : LIGHT;
    meridianRibbon(ctx, 0, deg(width) / 2);
  });
}

/** The equator needs no line of its own — it is the seam between the two
 *  hemispheres. It carries a scale instead, ticking north into the light. */
function paintEquatorTicks(ctx: CanvasRenderingContext2D) {
  const y = latToY(0);
  ctx.lineWidth = deg(SCALE_TICK_W_DEG);
  for (let lon = -180; lon < 180; lon += SCALE_STEP_DEG) {
    const len = deg(lon % 10 === 0 ? 2.1 : 1.3);
    const x = lonToX(lon);
    segment(ctx, x, y, x, y - len);
  }
}

const GLYPH_DEG = 7.5;
const GLYPH_PAD_DEG = 1.6;

/** One numeral, cleared of the lines running under it.
 *
 *  **Two horizontal corrections ride the same transform:** the mirror cancels
 *  the ball's reflected model matrix, and `lonStretch` cancels the
 *  equirectangular squeeze. */
function numeral(
  ctx: CanvasRenderingContext2D,
  text: string,
  lon: number,
  lat: number,
  bg: string,
  ink: string,
) {
  const stretch = lonStretch(lat);
  const y = latToY(lat);
  const w = (ctx.measureText(text).width + deg(GLYPH_PAD_DEG)) * stretch;
  const h = deg(GLYPH_DEG + GLYPH_PAD_DEG);
  const x = lonToX(lon);

  // A numeral straddling ±180° sits on the texture's own edge, so half of it
  // would fall off the canvas — draw the wrapped copy too and let RepeatWrapping
  // join them.
  const copies = [x];
  if (x - w / 2 < 0) copies.push(x + TEX_W);
  if (x + w / 2 > TEX_W) copies.push(x - TEX_W);

  for (const cx of copies) {
    ctx.fillStyle = bg;
    ctx.fillRect(cx - w / 2, y - h / 2, w, h);
    ctx.fillStyle = ink;
    ctx.save();
    ctx.translate(cx, y);
    ctx.scale(-stretch, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

/** FDAI numerals: tens of degrees with the trailing zero dropped, one size
 *  throughout, painted at **every crossing of a solid line with a tick track**
 *  — the solid line's own value, so following a line around the ball reads the
 *  same number the whole way. Two exceptions: nothing above ±60°, where the
 *  meridians crowd, and nothing on the prime meridian, which carries its own
 *  rail and the two `0` badges instead. */
function paintNumerals(ctx: CanvasRenderingContext2D, north: boolean) {
  const bg = north ? LIGHT : DARK;
  const ink = north ? DARK : LIGHT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${deg(GLYPH_DEG)}px ${FONT}`;

  const trackLats = north ? [15, 45] : [-15, -45];
  for (let lon = -180; lon < 180; lon += SOLID_STEP_DEG) {
    if (lon === 0) continue;
    const tens = String(Math.round((((lon % 360) + 360) % 360) / 10));
    for (const lat of trackLats) numeral(ctx, tens, lon, lat, bg, ink);
  }

  const trackLons: number[] = [];
  for (let lon = -165; lon <= 165; lon += SOLID_STEP_DEG) trackLons.push(lon);
  for (const lat of north ? [30, 60] : [-30, -60]) {
    const tens = String(Math.abs(lat) / 10);
    for (const lon of trackLons) numeral(ctx, tens, lon, lat, bg, ink);
  }
}

/** The two `0` badges: light D-shapes, flat edge against the equator, hanging
 *  into the dark hemisphere at ±15° of the prime meridian. */
function paintZeroBadges(ctx: CanvasRenderingContext2D) {
  const h = deg(GLYPH_DEG + GLYPH_PAD_DEG);
  const w = deg(6.5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${deg(GLYPH_DEG)}px ${FONT}`;
  for (const lon of [15, -15]) {
    const x = lonToX(lon);
    const top = latToY(0) + deg(0.6);
    ctx.fillStyle = LIGHT;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top, w, h, [deg(0.6), deg(0.6), w / 2, w / 2]);
    ctx.fill();
    ctx.fillStyle = DARK;
    ctx.save();
    ctx.translate(x, top + h / 2 - deg(0.8));
    ctx.scale(-1, 1);
    ctx.fillText('0', 0, 0);
    ctx.restore();
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
    ctx.restore();
  }
  paintPrimeRails(ctx);
  for (const north of [true, false]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, north ? 0 : equator, TEX_W, north ? equator : TEX_H - equator);
    ctx.clip();
    paintNumerals(ctx, north);
    ctx.restore();
  }
  paintZeroBadges(ctx);

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
  // Front-facing, despite the reflected model matrix: three.js reads the world
  // matrix's determinant and flips the winding itself, so the near hemisphere
  // is the one that survives culling and the far one costs nothing.
  const material = new THREE.MeshBasicMaterial({ map });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), material);
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
