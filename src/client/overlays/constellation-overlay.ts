import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { projectToScreenInto } from './overlay-project';
import { setStrAttr } from './dirty-attr';

// Pixel radius left blank around every figure-star so lines don't obscure
// the star glyph.
export const STAR_GAP_PX = 9;

export function createConstellationOverlay(stellata: Stellata) {
  const overlay = document.getElementById('overlay') as unknown as SVGSVGElement;
  const figure = document.getElementById('con-figure') as unknown as SVGPathElement;

  const v = new THREE.Vector3();

  // Reused per-vertex projection scratch, grown on demand and never
  // shrunk. A chart-mode tick walks every polyline vertex across all 88
  // constellations, so pooling avoids a [number, number] tuple allocation
  // per vertex per frame; slots are overwritten (not read) across
  // polylines, so reuse across polylines within the same tick is safe.
  const projX: number[] = [];
  const projY: number[] = [];
  const projValid: boolean[] = [];
  const ensureProjCapacity = (n: number) => {
    while (projX.length < n) {
      projX.push(0);
      projY.push(0);
      projValid.push(false);
    }
  };
  const projScratch: [number, number] = [0, 0];

  let current = -1;
  let chartActive = false;
  let visible = true;
  // Dirty-tracked path data — segments.join('') is recomputed every frame
  // but is identical when the camera is stationary. Skipping the
  // setAttribute avoids SVG attribute parsing on a string that can be
  // hundreds of segments wide in chart mode. Poison '\0' sentinel forces
  // the first write through even when the initial computed d is the empty
  // string (e.g. session starts with no constellation highlighted).
  let lastD = '\0';

  // Full-tick skip — same pattern as chart-labels.ts: the path is a pure
  // function of camera pose, viewport, advanced epoch, and filter state.
  // Filter / mode changes route through update(), which poisons the pose
  // sentinel so the next tick always recomputes.
  const lastTickCamPos = new THREE.Vector3(NaN, NaN, NaN);
  const lastTickCamQuat = new THREE.Quaternion(NaN, 0, 0, 0);
  let lastTickViewportW = 0;
  let lastTickViewportH = 0;
  let lastTickEpochJyr = NaN;

  // Per-tick scratch, reused across frames (cleared, never reallocated).
  const segments: string[] = [];
  const indices: number[] = [];

  const update = () => {
    const f = stellata.getFilter();
    current = f.highlightCon;
    visible = f.showConstellation;
    chartActive = f.chart && stellata.getCameraMode() === 'observe';
    lastTickCamPos.set(NaN, NaN, NaN);
    if (!visible || (current < 0 && !chartActive)) {
      lastD = setStrAttr(figure, 'd', '', lastD);
      return;
    }
    tick();
  };

  const tick = () => {
    if (!visible) return;
    if (current < 0 && !chartActive) return;

    const cons = stellata.catalog.constellations;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const camera = stellata.camera;
    const positions = stellata.localPositions;

    const epochJyr = stellata.advancedEpochJyr;
    if (
      camera.position.equals(lastTickCamPos)
      && camera.quaternion.equals(lastTickCamQuat)
      && w === lastTickViewportW
      && h === lastTickViewportH
      && epochJyr === lastTickEpochJyr
    ) {
      return;
    }
    lastTickCamPos.copy(camera.position);
    lastTickCamQuat.copy(camera.quaternion);
    lastTickViewportW = w;
    lastTickViewportH = h;
    lastTickEpochJyr = epochJyr;

    segments.length = 0;
    // Chart mode draws every constellation; otherwise only the highlighted
    // one. Same projection + near-clip path either way.
    indices.length = 0;
    if (chartActive) {
      for (let i = 0; i < cons.length; i++) indices.push(i);
    } else if (current >= 0 && current < cons.length) {
      indices.push(current);
    }

    for (const conIdx of indices) {
      const lines = cons[conIdx].lines;
      if (!lines || lines.length === 0) continue;
      for (const polyline of lines) {
        ensureProjCapacity(polyline.length);
        for (let k = 0; k < polyline.length; k++) {
          const i = polyline[k];
          v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
          projValid[k] = projectToScreenInto(v, camera, w, h, projScratch);
          if (projValid[k]) {
            projX[k] = projScratch[0];
            projY[k] = projScratch[1];
          }
        }

        for (let j = 0; j < polyline.length - 1; j++) {
          if (!projValid[j] || !projValid[j + 1]) continue;
          const seg = shortenedSegment(projX[j], projY[j], projX[j + 1], projY[j + 1]);
          if (seg) segments.push(seg);
        }
      }
    }
    lastD = setStrAttr(figure, 'd', segments.join(''), lastD);
  };

  stellata.on('filter', update);
  stellata.on('cameraMode', update);
  stellata.on('frame', tick);
  update();

  return { overlay };
}

// `M..L..` subpath with both endpoints pulled back by STAR_GAP_PX so the
// vertex stars sit in clean circular gaps (combined with stroke-linecap:
// round on the path).
function shortenedSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): string | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= STAR_GAP_PX * 2) return null;
  const ux = dx / len;
  const uy = dy / len;
  const sx = ax + ux * STAR_GAP_PX;
  const sy = ay + uy * STAR_GAP_PX;
  const ex = bx - ux * STAR_GAP_PX;
  const ey = by - uy * STAR_GAP_PX;
  return `M${sx.toFixed(1)},${sy.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}`;
}
