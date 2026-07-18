import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { renderedSizePx } from '../camera/controls/star-physics';
import { projectToScreenInto } from './overlay-project';
import { selectMaskCandidates, selectPlanetMaskCandidates } from './disc-mask-pure';
import { setNumAttr } from './dirty-attr';

// Per-frame SVG mask updater. Overlays using mask="url(#disc-occlude-mask)"
// render BEHIND close rendered discs. Cutouts are placed for the
// most-recently-focused star + its binary companion (lastFocused, not
// current, so Esc-unfocus doesn't drop the mask while the disc is still
// visible — placeSlot self-evicts when the disc shrinks) plus every
// highlighted-constellation vertex whose disc exceeds the threshold, plus
// every visible planet body (a foreground physical body occludes the
// background asterism the same way a star disc does).
//
// Selection contract pinned in disc-mask-pure.test.ts.
const DISC_THRESHOLD_PX = 48;
// Soft cap on the cutout pool. Today's ceiling is the largest Stellarium
// asterism (~40 vertices) + 2 for focal + companion + Sol's ~9 planet
// bodies; 64 leaves headroom without ever firing in practice. Exceeding
// it warns once (dev signal that the iteration source changed); growth
// itself is not blocked.
const MAX_MASK_CIRCLES = 64;

interface Slot {
  el: SVGCircleElement;
  lastCx: number;
  lastCy: number;
  lastR: number;
}

export function createDiscMask(stellata: Stellata) {
  const mask = document.getElementById('disc-occlude-mask') as unknown as SVGMaskElement;
  // Remove any placeholder cutout from the static HTML first; we manage the
  // mask children fully from here.
  const original = document.getElementById('disc-mask-cutout');
  if (original) original.remove();

  // Pool of Slot wrappers, grown on demand and never shrunk. Allocations are
  // rare (bounded by max constellation member count + 2 for focal+companion).
  // NaN sentinel init forces the first attribute write through the dirty-
  // track gate even when the desired value happens to match the static
  // -100/-100/0 placeholder.
  const slots: Slot[] = [];
  let capExceededWarned = false;
  const ensureSlots = (n: number) => {
    if (n > MAX_MASK_CIRCLES && !capExceededWarned) {
      console.warn(
        `disc-mask: pool grew to ${n}, exceeds expected ceiling ${MAX_MASK_CIRCLES} — check whether the iteration source changed.`,
      );
      capExceededWarned = true;
    }
    while (slots.length < n) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', '-100');
      c.setAttribute('cy', '-100');
      c.setAttribute('r', '0');
      c.setAttribute('fill', 'black');
      mask.appendChild(c);
      slots.push({ el: c, lastCx: NaN, lastCy: NaN, lastR: NaN });
    }
  };

  const v = new THREE.Vector3();
  const outXY: [number, number] = [0, 0];

  const clearSlot = (s: Slot) => {
    s.lastCx = setNumAttr(s.el, 'cx', -100, s.lastCx);
    s.lastCy = setNumAttr(s.el, 'cy', -100, s.lastCy);
    s.lastR = setNumAttr(s.el, 'r', 0, s.lastR);
  };

  // Project a star's world position to screen + set a mask circle. Returns
  // whether a circle was placed (false = off-screen / too small).
  const placeSlot = (s: Slot, idx: number): boolean => {
    const size = renderedSizePx({
      catalog: stellata.catalog,
      idx,
      camPos: stellata.camera.position,
      localPositions: stellata.localPositions,
      uniforms: stellata.uniforms,
      filter: stellata.getFilter(),
      suppressPulsation: stellata.suppressPulsation,
    });
    if (size <= DISC_THRESHOLD_PX) return false;
    const positions = stellata.localPositions;
    const camera = stellata.camera;
    v.set(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]);
    if (!projectToScreenInto(v, camera, window.innerWidth, window.innerHeight, outXY)) return false;
    s.lastCx = setNumAttr(s.el, 'cx', outXY[0], s.lastCx);
    s.lastCy = setNumAttr(s.el, 'cy', outXY[1], s.lastCy);
    s.lastR = setNumAttr(s.el, 'r', size * 0.5, s.lastR);
    return true;
  };

  // Project a planet body to screen + set a mask circle. Returns whether a
  // circle was placed (false = culled / sub-cutoff / off-screen).
  // renderedPlanetSizePx already floors visible discs and returns 0 below
  // the magnitude cutoff, so a `size <= 0` gate needs no separate threshold.
  const placePlanetSlot = (s: Slot, instanceIdx: number): boolean => {
    const field = stellata.planetField;
    const size = field.renderedPlanetSizePx(instanceIdx, stellata.camera.position);
    if (size <= 0) return false;
    if (!field.planetLocalPositionInto(instanceIdx, v)) return false;
    if (!projectToScreenInto(v, stellata.camera, window.innerWidth, window.innerHeight, outXY)) {
      return false;
    }
    s.lastCx = setNumAttr(s.el, 'cx', outXY[0], s.lastCx);
    s.lastCy = setNumAttr(s.el, 'cy', outXY[1], s.lastCy);
    s.lastR = setNumAttr(s.el, 'r', size * 0.5, s.lastR);
    return true;
  };

  // Cache the highlighted-constellation index so the per-frame tick doesn't
  // re-read getFilter() each frame. Mirrors constellation-overlay.ts (which
  // consumes the same field via the 'filter' event) so the two overlays react
  // to filter mutations through the same mechanism.
  let highlightCon = stellata.getFilter().highlightCon;
  let chart = stellata.getFilter().chart;
  let showConstellation = stellata.getFilter().showConstellation;
  stellata.on('filter', (f) => {
    highlightCon = f.highlightCon;
    chart = f.chart;
    showConstellation = f.showConstellation;
  });

  // Track the most-recently-focused star + its companion. Updated only on
  // focus *acquisition* (idx !== null); never cleared. This is what keeps
  // the focal-pair mask alive after Esc-unfocus until the disc shrinks.
  let recentFocus: number | null = null;
  let recentCompanion = -1;
  stellata.on('focus', (target) => {
    if (target !== null && target.kind === 'star') {
      recentFocus = target.idx;
      recentCompanion = stellata.catalog.companion[target.idx];
    }
  });

  // Track how many slots were active last frame so we only clear the
  // tail end of the pool that is no longer used.
  let lastUsed = 0;

  stellata.on('frame', () => {
    const observe =
      stellata.getCameraMode() === 'observe' || stellata.isObserveTransitionActive();

    let used = 0;

    // Star disc cutouts skip in observe: the focal pair is shader-hidden,
    // and every other star sits at least an inter-star gap from a camera
    // parked at the focal star (setFocus moves it to the focal local
    // origin), so none reaches the disc threshold.
    if (!observe) {
      const candidates = selectMaskCandidates(
        recentFocus,
        recentCompanion,
        highlightCon,
        stellata.catalog.constellations,
      );
      for (const idx of candidates) {
        ensureSlots(used + 1);
        if (placeSlot(slots[used], idx)) used++;
      }
    }

    // Planet bodies occlude the figure in every mode — unlike stars they can
    // sit close to the camera under observe/chart. Gated on the same inputs
    // that give the figure content (constellation-overlay.ts), so idle frames
    // skip the projection pass.
    const figureHasContent = showConstellation && (highlightCon >= 0 || (chart && observe));
    if (figureHasContent) {
      const planets = stellata.planetField;
      const planetCandidates = selectPlanetMaskCandidates(
        planets.liveInstanceCount,
        planets.hiddenInstanceIdx,
      );
      for (const idx of planetCandidates) {
        ensureSlots(used + 1);
        if (placePlanetSlot(slots[used], idx)) used++;
      }
    }

    for (let i = used; i < lastUsed; i++) clearSlot(slots[i]);
    lastUsed = used;
  });
}
