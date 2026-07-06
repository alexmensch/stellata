import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { galacticDirToIcrs } from './galactic-coords';
import { SPHERE_RADIUS_PC } from './galactic-grid';
import { formatGalLon, formatGalLat } from '../ui/gal-coord-format';
import { projectToScreenInto } from '../overlays/overlay-project';
import { setNumAttr, setStrAttr, setStyle, setText } from '../overlays/dirty-attr';

// Orientation labels for the galactic coordinate sphere (galactic-grid.ts).
// One label per grid line — every meridian (galactic longitude l) and every
// latitude ring (b, including the equator; the poles carry no ring). Rather
// than sitting on the l/b node (where the text would cross the orthogonal
// line), each label slides along its own line to where the line exits the
// viewport, settling at the bottom-most edge crossing, tilted onto the line's
// slope and inset just inside the frame — and skipping the on-screen chrome
// (settings panel, brand box, scale bar, meta) so it never lands on top of
// them. Text runs through formatGalLon/formatGalLat so the decimal↔DMS toggle
// reformats the live labels.

const DEG = Math.PI / 180;
// Meridians every 10° of l; latitude rings every 10° of b incl. the equator,
// excluding the ±90° poles (no ring there — the meridians just converge).
const MERIDIAN_COUNT = 36;
const LAT_RING_DEGS = [0, -80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80];
// Line-sampling resolution — coarse is fine, the edge crossing is found by
// linear interpolation between samples.
const MERIDIAN_SAMPLES = 19; // over b ∈ [-84°, 84°]
const MERIDIAN_MAX_B_DEG = 84;
const RING_SAMPLES = 37; // over l ∈ [0°, 360°], last repeats the first to close
// Standard orthogonal padding: a label keeps this gap from both the viewport
// edge it drops to and any chrome rect it avoids.
const ORTHO_PAD_PX = 10;
// Chrome to keep labels clear of; hidden elements report a zero-area rect and
// are ignored.
const EXCLUDE_SELECTORS = ['ui-top', 'ui-top-left', 'scale-bar', 'meta', 'controls-restore-btn'];

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
}

function inAnyRect(x: number, y: number, rects: Rect[]): boolean {
  for (const r of rects) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

/**
 * Place a grid-line label at the bottom-most point where the projected line
 * (xs/ys, with NaN entries for samples behind the camera) exits the viewport.
 * The label is inset `insetPx` inside the crossed edge along its inward normal
 * and rotated onto the crossing segment's tangent (folded into (−90°, 90°] so
 * it stays upright). Crossings whose inset position lands inside an excluded
 * chrome rect are skipped. Returns null when the line makes no usable exit.
 */
export function edgeLabelPlacement(
  xs: number[],
  ys: number[],
  n: number,
  w: number,
  h: number,
  insetPx: number,
  exclude: Rect[],
): EdgeLabel | null {
  let best: EdgeLabel | null = null;
  let bestY = -Infinity;

  const consider = (
    cx: number,
    cy: number,
    normX: number,
    normY: number,
    tx: number,
    ty: number,
  ) => {
    let x = cx + normX * insetPx;
    let y = cy + normY * insetPx;
    x = Math.min(Math.max(x, ORTHO_PAD_PX), w - ORTHO_PAD_PX);
    y = Math.min(Math.max(y, ORTHO_PAD_PX), h - ORTHO_PAD_PX);
    if (inAnyRect(x, y, exclude)) return;
    if (y <= bestY) return;
    const len = Math.hypot(tx, ty);
    if (len < 1e-6) return;
    let rotDeg = (Math.atan2(ty, tx) * 180) / Math.PI;
    if (rotDeg > 90) rotDeg -= 180;
    else if (rotDeg <= -90) rotDeg += 180;
    bestY = y;
    best = { x, y, rotDeg };
  };

  for (let i = 0; i + 1 < n; i++) {
    const x1 = xs[i];
    const y1 = ys[i];
    const x2 = xs[i + 1];
    const y2 = ys[i + 1];
    if (Number.isNaN(x1) || Number.isNaN(x2)) continue;
    const dx = x2 - x1;
    const dy = y2 - y1;

    // Bottom edge y=h, inward normal (0,-1).
    if ((y1 - h) * (y2 - h) < 0 && dy !== 0) {
      const t = (h - y1) / dy;
      const cx = x1 + t * dx;
      if (cx >= 0 && cx <= w) consider(cx, h, 0, -1, dx, dy);
    }
    // Top edge y=0, inward normal (0,1).
    if (y1 * y2 < 0 && dy !== 0) {
      const t = -y1 / dy;
      const cx = x1 + t * dx;
      if (cx >= 0 && cx <= w) consider(cx, 0, 0, 1, dx, dy);
    }
    // Left edge x=0, inward normal (1,0).
    if (x1 * x2 < 0 && dx !== 0) {
      const t = -x1 / dx;
      const cy = y1 + t * dy;
      if (cy >= 0 && cy <= h) consider(0, cy, 1, 0, dx, dy);
    }
    // Right edge x=w, inward normal (-1,0).
    if ((x1 - w) * (x2 - w) < 0 && dx !== 0) {
      const t = (w - x1) / dx;
      const cy = y1 + t * dy;
      if (cy >= 0 && cy <= h) consider(w, cy, -1, 0, dx, dy);
    }
  }

  return best;
}

interface Entry {
  el: SVGTextElement;
  kind: 'lon' | 'lat';
  valueDeg: number;
  /** ICRS unit directions along the line (fixed in absolute space). */
  dirs: THREE.Vector3[];
  lastDisplay: string;
  lastText: string;
  lastX: number;
  lastY: number;
  lastTransform: string;
}

function buildEntries(): Array<Omit<Entry, 'el' | 'lastDisplay' | 'lastText' | 'lastX' | 'lastY' | 'lastTransform'>> {
  const out: Array<{ kind: 'lon' | 'lat'; valueDeg: number; dirs: THREE.Vector3[] }> = [];

  for (let i = 0; i < MERIDIAN_COUNT; i++) {
    const lonDeg = (i * 360) / MERIDIAN_COUNT;
    const lonRad = lonDeg * DEG;
    const dirs: THREE.Vector3[] = [];
    for (let s = 0; s < MERIDIAN_SAMPLES; s++) {
      const bDeg = -MERIDIAN_MAX_B_DEG + (s / (MERIDIAN_SAMPLES - 1)) * (2 * MERIDIAN_MAX_B_DEG);
      dirs.push(galacticDirToIcrs(lonRad, bDeg * DEG, new THREE.Vector3()));
    }
    out.push({ kind: 'lon', valueDeg: lonDeg, dirs });
  }

  for (const bDeg of LAT_RING_DEGS) {
    const bRad = bDeg * DEG;
    const dirs: THREE.Vector3[] = [];
    for (let s = 0; s < RING_SAMPLES; s++) {
      const lRad = (s / (RING_SAMPLES - 1)) * 2 * Math.PI;
      dirs.push(galacticDirToIcrs(lRad, bRad, new THREE.Vector3()));
    }
    out.push({ kind: 'lat', valueDeg: bDeg, dirs });
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

  const hide = (e: Entry) => {
    e.lastDisplay = setStyle(e.el, 'display', 'none', e.lastDisplay);
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

      const p = edgeLabelPlacement(xs, ys, n, w, h, ORTHO_PAD_PX, exclude);
      if (!p) {
        hide(e);
        continue;
      }

      const text = e.kind === 'lon' ? formatGalLon(e.valueDeg) : formatGalLat(e.valueDeg);
      e.lastDisplay = setStyle(e.el, 'display', '', e.lastDisplay);
      e.lastText = setText(e.el, text, e.lastText);
      e.lastX = setNumAttr(e.el, 'x', p.x, e.lastX);
      e.lastY = setNumAttr(e.el, 'y', p.y, e.lastY);
      const transform = `rotate(${p.rotDeg.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})`;
      e.lastTransform = setStrAttr(e.el, 'transform', transform, e.lastTransform);
    }
  });
}
