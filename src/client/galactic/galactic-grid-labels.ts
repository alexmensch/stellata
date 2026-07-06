import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { galacticDirToIcrs } from './galactic-coords';
import { SPHERE_RADIUS_PC } from './galactic-grid';
import { projectToScreenInto } from '../overlays/overlay-project';
import { setNumAttr, setStrAttr, setStyle, setText } from '../overlays/dirty-attr';

// Orientation labels for the galactic coordinate sphere (galactic-grid.ts).
// One whole-degree label per grid line — every meridian (galactic longitude
// l) and every latitude ring (b, incl. the equator; the ±90° poles carry no
// ring). Rather than sit on the l/b node (where the text would cross the
// orthogonal line), each label slides along its own line to where the line
// exits the viewport, settling at the bottom-most edge crossing, tilted onto
// the line's slope. Its full rotated box is kept a standard pad inside the
// frame and clear of on-screen chrome (settings panel, brand box, scale bar,
// meta), and a deterministic repulsion pass spreads labels that would
// otherwise pile up where many lines converge near an edge.

const DEG = Math.PI / 180;
const MERIDIAN_COUNT = 36;
const LAT_RING_DEGS = [0, -80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80];
const MERIDIAN_SAMPLES = 19; // over b ∈ [-84°, 84°]
const MERIDIAN_MAX_B_DEG = 84;
const RING_SAMPLES = 37; // over l ∈ [0°, 360°], last repeats the first to close

// Standard orthogonal padding kept between a label's box and both the viewport
// edge it drops to and any chrome rect it avoids.
const ORTHO_PAD_PX = 10;
const EXCLUDE_SELECTORS = ['ui-top', 'ui-top-left', 'scale-bar', 'meta', 'controls-restore-btn'];

// Text-box estimate for layout (avoids a per-frame getBBox). Slightly generous
// so repulsion leaves a real visual gap. Track LABEL_FONT_PX to styles.css.
const CHAR_W_PX = 6.5;
const LABEL_HALF_H_PX = 6;
// Deterministic overlap-resolution sweeps per frame.
const SEPARATION_ITERS = 6;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EdgeLabel {
  x: number;
  y: number;
  rotDeg: number;
  /** Axis-aligned half-extents of the rotated text box. */
  hx: number;
  hy: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// AABB half-extents of a text box (half-size halfW × halfH) rotated by rotRad.
function rotatedHalfExtents(halfW: number, halfH: number, rotRad: number): [number, number] {
  const c = Math.abs(Math.cos(rotRad));
  const s = Math.abs(Math.sin(rotRad));
  return [halfW * c + halfH * s, halfW * s + halfH * c];
}

function boxesOverlap(
  ax: number, ay: number, ahx: number, ahy: number,
  bx: number, by: number, bhx: number, bhy: number,
): boolean {
  return Math.abs(ax - bx) < ahx + bhx && Math.abs(ay - by) < ahy + bhy;
}

function overlapsAnyRect(x: number, y: number, hx: number, hy: number, rects: Rect[]): boolean {
  for (const r of rects) {
    const rcx = (r.left + r.right) / 2;
    const rcy = (r.top + r.bottom) / 2;
    const rhx = (r.right - r.left) / 2;
    const rhy = (r.bottom - r.top) / 2;
    if (boxesOverlap(x, y, hx, hy, rcx, rcy, rhx, rhy)) return true;
  }
  return false;
}

/**
 * Place a grid-line label at the bottom-most point where the projected line
 * (xs/ys, NaN for samples behind the camera) exits the viewport. The full
 * rotated text box (from halfW/halfH) is clamped a `pad` inside the viewport
 * and rotated onto the crossing segment's tangent (folded into (−90°, 90°] so
 * it stays upright); crossings whose box would overlap an excluded chrome rect
 * are skipped. Returns null when the line makes no usable exit.
 */
export function edgeLabelPlacement(
  xs: number[],
  ys: number[],
  n: number,
  w: number,
  h: number,
  halfW: number,
  halfH: number,
  pad: number,
  exclude: Rect[],
): EdgeLabel | null {
  let best: EdgeLabel | null = null;
  let bestY = -Infinity;

  const consider = (cx: number, cy: number, tx: number, ty: number) => {
    const len = Math.hypot(tx, ty);
    if (len < 1e-6) return;
    let rotDeg = (Math.atan2(ty, tx) * 180) / Math.PI;
    if (rotDeg > 90) rotDeg -= 180;
    else if (rotDeg <= -90) rotDeg += 180;
    const [hx, hy] = rotatedHalfExtents(halfW, halfH, rotDeg * DEG);
    const x = clamp(cx, pad + hx, w - pad - hx);
    const y = clamp(cy, pad + hy, h - pad - hy);
    if (overlapsAnyRect(x, y, hx, hy, exclude)) return;
    if (y <= bestY) return;
    bestY = y;
    best = { x, y, rotDeg, hx, hy };
  };

  for (let i = 0; i + 1 < n; i++) {
    const x1 = xs[i];
    const y1 = ys[i];
    const x2 = xs[i + 1];
    const y2 = ys[i + 1];
    if (Number.isNaN(x1) || Number.isNaN(x2)) continue;
    const dx = x2 - x1;
    const dy = y2 - y1;

    if ((y1 - h) * (y2 - h) < 0 && dy !== 0) {
      const cx = x1 + ((h - y1) / dy) * dx;
      if (cx >= 0 && cx <= w) consider(cx, h, dx, dy);
    }
    if (y1 * y2 < 0 && dy !== 0) {
      const cx = x1 + (-y1 / dy) * dx;
      if (cx >= 0 && cx <= w) consider(cx, 0, dx, dy);
    }
    if (x1 * x2 < 0 && dx !== 0) {
      const cy = y1 + (-x1 / dx) * dy;
      if (cy >= 0 && cy <= h) consider(0, cy, dx, dy);
    }
    if ((x1 - w) * (x2 - w) < 0 && dx !== 0) {
      const cy = y1 + ((w - x1) / dx) * dy;
      if (cy >= 0 && cy <= h) consider(w, cy, dx, dy);
    }
  }

  return best;
}

/**
 * Deterministically spread overlapping labels: repeated fixed-order sweeps
 * push overlapping label pairs apart along their least-overlapping axis (each
 * moves half), shove labels out of immovable chrome rects, then re-clamp every
 * label inside the viewport. No randomness — identical inputs give identical
 * output, so a static camera is stable frame-to-frame.
 */
export function separateLabels(
  labels: EdgeLabel[],
  chrome: Rect[],
  w: number,
  h: number,
  pad: number,
): void {
  const n = labels.length;
  for (let iter = 0; iter < SEPARATION_ITERS; iter++) {
    for (let i = 0; i < n; i++) {
      const a = labels[i];
      for (let j = i + 1; j < n; j++) {
        const b = labels[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = a.hx + b.hx - Math.abs(dx);
        const oy = a.hy + b.hy - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) {
          const push = (dx >= 0 ? 1 : -1) * (ox / 2 + 0.5);
          a.x -= push;
          b.x += push;
        } else {
          const push = (dy >= 0 ? 1 : -1) * (oy / 2 + 0.5);
          a.y -= push;
          b.y += push;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const a = labels[i];
      for (const r of chrome) {
        const rcx = (r.left + r.right) / 2;
        const rcy = (r.top + r.bottom) / 2;
        const rhx = (r.right - r.left) / 2;
        const rhy = (r.bottom - r.top) / 2;
        const dx = a.x - rcx;
        const dy = a.y - rcy;
        const ox = a.hx + rhx - Math.abs(dx);
        const oy = a.hy + rhy - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (ox < oy) a.x += (dx >= 0 ? 1 : -1) * (ox + 0.5);
        else a.y += (dy >= 0 ? 1 : -1) * (oy + 0.5);
      }
      a.x = clamp(a.x, pad + a.hx, w - pad - a.hx);
      a.y = clamp(a.y, pad + a.hy, h - pad - a.hy);
    }
  }
}

// Whole-degree label. Longitude wraps to [0, 360); latitude stays signed.
function fmtDeg(deg: number, wrap360: boolean): string {
  let d = Math.round(deg);
  if (wrap360) d = ((d % 360) + 360) % 360;
  return `${d}°`;
}

interface Entry {
  el: SVGTextElement;
  kind: 'lon' | 'lat';
  valueDeg: number;
  text: string;
  halfW: number;
  /** ICRS unit directions along the line (fixed in absolute space). */
  dirs: THREE.Vector3[];
  placement: EdgeLabel | null;
  lastDisplay: string;
  lastText: string;
  lastX: number;
  lastY: number;
  lastTransform: string;
}

function buildEntries(): Array<Pick<Entry, 'kind' | 'valueDeg' | 'text' | 'halfW' | 'dirs'>> {
  const out: Array<Pick<Entry, 'kind' | 'valueDeg' | 'text' | 'halfW' | 'dirs'>> = [];
  const push = (kind: 'lon' | 'lat', valueDeg: number, dirs: THREE.Vector3[]) => {
    const text = fmtDeg(valueDeg, kind === 'lon');
    out.push({ kind, valueDeg, text, halfW: (text.length * CHAR_W_PX) / 2, dirs });
  };

  for (let i = 0; i < MERIDIAN_COUNT; i++) {
    const lonRad = ((i * 360) / MERIDIAN_COUNT) * DEG;
    const dirs: THREE.Vector3[] = [];
    for (let s = 0; s < MERIDIAN_SAMPLES; s++) {
      const bDeg = -MERIDIAN_MAX_B_DEG + (s / (MERIDIAN_SAMPLES - 1)) * (2 * MERIDIAN_MAX_B_DEG);
      dirs.push(galacticDirToIcrs(lonRad, bDeg * DEG, new THREE.Vector3()));
    }
    push('lon', (i * 360) / MERIDIAN_COUNT, dirs);
  }

  for (const bDeg of LAT_RING_DEGS) {
    const bRad = bDeg * DEG;
    const dirs: THREE.Vector3[] = [];
    for (let s = 0; s < RING_SAMPLES; s++) {
      dirs.push(galacticDirToIcrs((s / (RING_SAMPLES - 1)) * 2 * Math.PI, bRad, new THREE.Vector3()));
    }
    push('lat', bDeg, dirs);
  }

  return out;
}

function gatherExcludeRects(): Rect[] {
  const rects: Rect[] = [];
  for (const id of EXCLUDE_SELECTORS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    rects.push({
      left: r.left - ORTHO_PAD_PX,
      top: r.top - ORTHO_PAD_PX,
      right: r.right + ORTHO_PAD_PX,
      bottom: r.bottom + ORTHO_PAD_PX,
    });
  }
  return rects;
}

export function createGalacticGridLabels(stellata: Stellata): void {
  const group = document.getElementById('gal-grid-labels') as unknown as SVGGElement | null;
  if (!group) return;

  const NS = 'http://www.w3.org/2000/svg';
  const pool: Entry[] = buildEntries().map((spec) => {
    const el = document.createElementNS(NS, 'text') as SVGTextElement;
    el.setAttribute('class', 'gal-grid-label');
    el.setAttribute('text-anchor', 'middle');
    el.setAttribute('dominant-baseline', 'central');
    el.style.display = 'none';
    group.appendChild(el);
    return {
      ...spec,
      el,
      placement: null,
      lastDisplay: 'none',
      lastText: '\0',
      lastX: NaN,
      lastY: NaN,
      lastTransform: '\0',
    };
  });

  const maxSamples = Math.max(MERIDIAN_SAMPLES, RING_SAMPLES);
  const xs = new Array<number>(maxSamples);
  const ys = new Array<number>(maxSamples);
  const world = new THREE.Vector3();
  const out: [number, number] = [0, 0];

  let groupVisible = true;
  const setGroupVisible = (on: boolean) => {
    if (on === groupVisible) return;
    group.style.display = on ? '' : 'none';
    groupVisible = on;
  };

  stellata.on('frame', () => {
    if (!stellata.getFilter().showGalacticGrid) {
      setGroupVisible(false);
      return;
    }
    setGroupVisible(true);

    const camera = stellata.camera;
    const camPos = camera.position;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const exclude = gatherExcludeRects();

    // Pass 1 — placement per line.
    const visible: EdgeLabel[] = [];
    for (const e of pool) {
      const dirs = e.dirs;
      const n = dirs.length;
      for (let s = 0; s < n; s++) {
        world.copy(dirs[s]).multiplyScalar(SPHERE_RADIUS_PC).add(camPos);
        if (projectToScreenInto(world, camera, w, h, out)) {
          xs[s] = out[0];
          ys[s] = out[1];
        } else {
          xs[s] = NaN;
          ys[s] = NaN;
        }
      }
      e.placement = edgeLabelPlacement(xs, ys, n, w, h, e.halfW, LABEL_HALF_H_PX, ORTHO_PAD_PX, exclude);
      if (e.placement) visible.push(e.placement);
    }

    // Pass 2 — deterministic de-overlap.
    separateLabels(visible, exclude, w, h, ORTHO_PAD_PX);

    // Pass 3 — write DOM.
    for (const e of pool) {
      const p = e.placement;
      if (!p) {
        e.lastDisplay = setStyle(e.el, 'display', 'none', e.lastDisplay);
        continue;
      }
      e.lastDisplay = setStyle(e.el, 'display', '', e.lastDisplay);
      e.lastText = setText(e.el, e.text, e.lastText);
      e.lastX = setNumAttr(e.el, 'x', p.x, e.lastX);
      e.lastY = setNumAttr(e.el, 'y', p.y, e.lastY);
      const transform = `rotate(${p.rotDeg.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})`;
      e.lastTransform = setStrAttr(e.el, 'transform', transform, e.lastTransform);
    }
  });
}
