import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { galacticDirToIcrs } from './galactic-coords';
import { SPHERE_RADIUS_PC } from './galactic-grid';
import { formatGalLon, formatGalLat } from '../ui/gal-coord-format';
import { projectToScreenInto } from '../overlays/overlay-project';
import { setNumAttr, setStrAttr, setStyle, setText } from '../overlays/dirty-attr';

// Orientation labels riding the galactic coordinate sphere (galactic-grid.ts).
// Longitude values ride each meridian along the equator; latitude values ride
// the b=±30°/±60° rings at four anchor longitudes so a latitude ladder stays
// near screen-centre from any heading. The equator itself is identified by
// the ring of longitude labels sitting on it, so it carries no separate b=0
// mark. Text is a readable subset of the every-10° grid, not one label per
// line, matching the grid's own polar-trim declutter intent.
//
// Each label projects a 3D anchor direction (camera-tracked, like the grid)
// plus a neighbour a few degrees along the labelled line; the screen-space
// delta gives the tangent the text rotates onto and the side it offsets to.

const LON_LABEL_DEGS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const LAT_LABEL_DEGS = [-60, -30, 30, 60];
const LAT_ANCHOR_LON_DEGS = [0, 90, 180, 270];

// Neighbour offset along the labelled line, for the screen-space tangent.
const TANGENT_STEP_RAD = (2 * Math.PI) / 180;
// Perpendicular gap from the line to the text baseline.
const LABEL_OFFSET_PX = 9;
// Within this much of vertical, the top-side choice is held (hysteresis) so a
// near-vertical line doesn't flip the label side frame-to-frame.
const HYST_SIN = Math.sin((5 * Math.PI) / 180);
const DEG = Math.PI / 180;

interface LabelSpec {
  /** 'lon' formats + rides the meridian; 'lat' formats + rides the ring. */
  kind: 'lon' | 'lat';
  lonRad: number;
  latRad: number;
  /** Neighbour direction offset picking the labelled line's tangent. */
  dLonRad: number;
  dLatRad: number;
  valueDeg: number;
}

export interface LabelPlacement {
  x: number;
  y: number;
  rotDeg: number;
  /** Top-side choice to carry into the next frame's hysteresis. */
  uxPos: boolean;
}

/**
 * Place a grid label from its projected anchor + a projected neighbour along
 * the labelled line. The text offsets to the screen-top side of the line and
 * rotates onto the line's tangent, kept upright (rotation folded into
 * (−90°, 90°]). `lastUxPos` is the previous frame's side choice; a tangent
 * within HYST_SIN of vertical reuses it so the top-side flip doesn't jitter.
 * Returns null for a degenerate (zero-length) screen tangent.
 */
export function placeGridLabel(
  ax: number,
  ay: number,
  nx: number,
  ny: number,
  offsetPx: number,
  lastUxPos: boolean,
): LabelPlacement | null {
  const tx = nx - ax;
  const ty = ny - ay;
  const len = Math.hypot(tx, ty);
  if (len < 1e-4) return null;
  const ux = tx / len;
  const uy = ty / len;

  let uxPos = lastUxPos;
  if (Math.abs(ux) > HYST_SIN) uxPos = ux >= 0;

  // Screen-top normal: (uy, −ux) when ux≥0, (−uy, ux) when ux<0 — the y
  // component is ≤ 0 either way, so the label rides above the line.
  const perpX = uxPos ? uy : -uy;
  const perpY = uxPos ? -ux : ux;

  let rotDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (rotDeg > 90) rotDeg -= 180;
  else if (rotDeg <= -90) rotDeg += 180;

  return {
    x: ax + perpX * offsetPx,
    y: ay + perpY * offsetPx,
    rotDeg,
    uxPos,
  };
}

interface Entry extends LabelSpec {
  el: SVGTextElement;
  lastDisplay: string;
  lastText: string;
  lastX: number;
  lastY: number;
  lastTransform: string;
  uxPos: boolean;
}

function buildSpecs(): LabelSpec[] {
  const specs: LabelSpec[] = [];
  for (const lonDeg of LON_LABEL_DEGS) {
    specs.push({
      kind: 'lon',
      lonRad: lonDeg * DEG,
      latRad: 0,
      dLonRad: 0,
      dLatRad: TANGENT_STEP_RAD,
      valueDeg: lonDeg,
    });
  }
  for (const anchorLonDeg of LAT_ANCHOR_LON_DEGS) {
    for (const latDeg of LAT_LABEL_DEGS) {
      specs.push({
        kind: 'lat',
        lonRad: anchorLonDeg * DEG,
        latRad: latDeg * DEG,
        dLonRad: TANGENT_STEP_RAD,
        dLatRad: 0,
        valueDeg: latDeg,
      });
    }
  }
  return specs;
}

export function createGalacticGridLabels(stellata: Stellata): void {
  const group = document.getElementById('gal-grid-labels') as unknown as SVGGElement | null;
  if (!group) return;

  const NS = 'http://www.w3.org/2000/svg';
  const pool: Entry[] = buildSpecs().map((spec) => {
    const el = document.createElementNS(NS, 'text') as SVGTextElement;
    el.setAttribute('class', 'gal-grid-label');
    el.setAttribute('text-anchor', 'middle');
    el.setAttribute('dominant-baseline', 'central');
    // Hidden until the first frame positions it — otherwise a grid-on URL
    // load paints every label at (0,0) for the frame before the handler runs.
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
      uxPos: true,
    };
  });

  const dirA = new THREE.Vector3();
  const dirN = new THREE.Vector3();
  const worldA = new THREE.Vector3();
  const worldN = new THREE.Vector3();
  const outA: [number, number] = [0, 0];
  const outN: [number, number] = [0, 0];

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

    for (const e of pool) {
      galacticDirToIcrs(e.lonRad, e.latRad, dirA);
      galacticDirToIcrs(e.lonRad + e.dLonRad, e.latRad + e.dLatRad, dirN);
      worldA.copy(dirA).multiplyScalar(SPHERE_RADIUS_PC).add(camPos);
      worldN.copy(dirN).multiplyScalar(SPHERE_RADIUS_PC).add(camPos);

      if (
        !projectToScreenInto(worldA, camera, w, h, outA) ||
        !projectToScreenInto(worldN, camera, w, h, outN)
      ) {
        hide(e);
        continue;
      }
      if (outA[0] < 0 || outA[0] > w || outA[1] < 0 || outA[1] > h) {
        hide(e);
        continue;
      }

      const p = placeGridLabel(outA[0], outA[1], outN[0], outN[1], LABEL_OFFSET_PX, e.uxPos);
      if (!p) {
        hide(e);
        continue;
      }
      e.uxPos = p.uxPos;

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
