import * as THREE from 'three';
import type { Stellata } from '../stellata';
import { renderedDiscPxAtPeak } from '../camera/controls/star-physics';
import { fmtDistAuto } from '../ui/distance-util';
import { resolveStarName } from '../format/star-companion-format';
import {
  buildArrowSvgPath,
  ARROW_HEAD_DEPTH_PX,
  ARROW_LABEL_OFFSET_PX,
  ARROW_LABEL_PADDING_PX,
  RING_HALO_GAP_PX,
} from './arrow-path';
import { applyFade, emptyFadeState, setNumAttr, setStrAttr, setStyle, setText } from './dirty-attr';
import { focusedArrowFadeAlpha } from './arrow-fade';
import { FOCUS_RING_RADIUS_PX } from './focus-ring-overlay';

// Source-end offset — shaft starts FOCUS_RING_RADIUS_PX + RING_HALO_GAP_PX
// past the focused star so it doesn't crowd the disc. Same derivation the
// HUD's Sol/GC arrows use for their navigate-mode shaft start, so any
// future change to the focus-ring radius or the universal halo gap
// propagates here automatically.
const SOURCE_OFFSET_PX = FOCUS_RING_RADIUS_PX + RING_HALO_GAP_PX;
// Cap how far past the viewport the clipped "off-screen" endpoint can extend,
// so the generated SVG path doesn't contain absurd coordinates.
const MAX_OFFSCREEN_FACTOR = 1.5;

/**
 * Three scratch vectors that projectWithNearClip mutates per call. Callers
 * that invoke the function in a hot path own one stable scratch in their
 * own scope and thread it in; ad-hoc / test callers omit the parameter and
 * accept a per-call allocation. Encapsulating the scratch in a parameter
 * (rather than at module scope) keeps the function safe to call from
 * sibling overlays, tests, or a shared util refactor without silent stale-
 * data hazards under back-to-back invocation.
 */
export interface ProjectScratch {
  va: THREE.Vector3;
  vb: THREE.Vector3;
  end: THREE.Vector3;
}

export function makeProjectScratch(): ProjectScratch {
  return {
    va: new THREE.Vector3(),
    vb: new THREE.Vector3(),
    end: new THREE.Vector3(),
  };
}

export function createDistanceVectorOverlay(
  stellata: Stellata,
  starLabels: Map<number, string>,
) {
  const line = document.getElementById('dist-line') as unknown as SVGPathElement;
  const lineBg = document.getElementById('dist-line-bg') as unknown as SVGPathElement;
  const label = document.getElementById('dist-label') as unknown as SVGTextElement;
  const distUi = document.getElementById('dist-ui') as unknown as SVGGElement;

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpClickAim = new THREE.Vector3();
  const projScratch = makeProjectScratch();

  // Clicking the distance label aims the camera at the destination —
  // the same affordance as the Sol/GC arrow labels. Warping there is
  // deliberately NOT on the label; it stays on the W key only.
  distUi.addEventListener('click', () => {
    const to = stellata.getVectorTarget();
    if (to !== null && stellata.focusables[to.kind].localPositionInto(to.idx, tmpClickAim)) {
      stellata.aimAt(tmpClickAim);
    }
  });

  // Idempotent hide: skip the SVG attribute writes and style mutation when
  // the vector is already hidden. The per-frame handler short-circuits to
  // hide() through several bail paths, so an unguarded hide ran 60×/sec
  // any time no vector was set.
  let visible = false;
  // Dirty-tracked attribute state — the per-frame handler recomputes every
  // value, but on a stationary camera the values are identical to the
  // previous frame. Skipping setAttribute / textContent / style writes
  // avoids SVG re-parse and inline-style invalidation cost. NaN / '\0'
  // sentinels guarantee the first write always lands through the gate.
  let lastLineD = '\0';
  let lastLineBgD = '\0';
  let lastLabelText = '\0';
  let lastLabelX = NaN;
  let lastLabelY = NaN;
  // Fade state (opacity + pointer-events). Shares the applyFade /
  // dirty-track / pointer-policy contract with hud-overlay's Sol/GC
  // arrows but computes its OWN alpha against its OWN drawn shaft
  // length — the distance-vector is typically longer than Sol/GC and
  // outlasts their fade by design (ml8 option B). See applyFade in
  // dirty-attr.ts and focusedArrowFadeAlpha in arrow-fade.ts.
  const fadeState = emptyFadeState();
  let lastDistUiDisplay = '\0';
  // Cache getComputedTextLength keyed on the rendered string. SVG's
  // getComputedTextLength forces a layout flush; it's stable for a given
  // string + font, so once measured we don't need to re-measure on a
  // stationary camera. The cache is invalidated once when document.fonts.ready
  // fires so a fallback-font measurement doesn't get pinned past the
  // webfont swap — see attachFontsReadyInvalidation.
  const labelWidthCache = makeLabelWidthCache();
  attachFontsReadyInvalidation(
    labelWidthCache,
    (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts,
  );

  const hide = () => {
    if (!visible) return;
    lastLineD = setStrAttr(line, 'd', '', lastLineD);
    lastLineBgD = setStrAttr(lineBg, 'd', '', lastLineBgD);
    lastDistUiDisplay = setStyle(distUi, 'display', 'none', lastDistUiDisplay);
    visible = false;
  };

  // A 'vector' emit that leaves the slot null is the canonical "no
  // vector" state — hide immediately rather than on the next frame.
  stellata.on('vector', () => {
    if (stellata.getVectorTarget() === null) hide();
  });

  // Destination display names stay a per-kind lookup — star labels live
  // on the search corpus, cloud / LG names on their catalogs.
  const destLabelOf = (to: { kind: string; idx: number }): string => {
    if (to.kind === 'star') {
      return resolveStarName(
        { starLabels, gaiaSourceId: stellata.catalog.gaiaSourceId, sid: stellata.catalog.sid },
        to.idx,
      );
    }
    if (to.kind === 'cloud') {
      const cat = stellata.getCloudCatalog();
      return cat ? cat.clouds[to.idx].name : 'Cloud';
    }
    return stellata.localGroup?.objects[to.idx]?.name ?? 'Galaxy';
  };

  stellata.on('frame', () => {
    const from = stellata.getFocusedTarget();
    const to = stellata.getVectorTarget();
    if (from === null || to === null) { hide(); return; }

    const camera = stellata.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Local-frame positions — the camera and projection math operate in
    // whatever frame the floating origin has set (see stellata.ts).
    if (!stellata.focusables[from.kind].localPositionInto(from.idx, tmpA)) { hide(); return; }
    if (!stellata.focusables[to.kind].localPositionInto(to.idx, tmpB)) { hide(); return; }
    const destLabel = destLabelOf(to);

    const projected = projectWithNearClip(tmpA, tmpB, camera, w, h, projScratch);
    if (!projected) { hide(); return; }
    const { pA, pB } = projected;

    // Source inset stays at the focus-ring offset; destination inset is
    // the destination's actual rendered silhouette diameter so the tip
    // lands on the visible edge regardless of size — a supergiant's disc
    // can fill a large fraction of the viewport, a dwarf is a few pixels,
    // and a nearby molecular cloud spans tens of degrees. Cloud silhouette
    // is keyed off the largest semi-axis (matches `cloudViewingDistancePc`);
    // exact for spheres, slight overshoot for prolate clouds viewed end-on.
    const destOffsetPx = Math.max(stellata.focusables[to.kind].renderedSizePx(to.idx), 0);
    const dxPx = pB[0] - pA[0];
    const dyPx = pB[1] - pA[1];
    const lenPx = Math.hypot(dxPx, dyPx);
    if (lenPx <= SOURCE_OFFSET_PX + destOffsetPx + 4) { hide(); return; }
    const uxPx = dxPx / lenPx;
    const uyPx = dyPx / lenPx;
    const shaftStartX = pA[0] + uxPx * SOURCE_OFFSET_PX;
    const shaftStartY = pA[1] + uyPx * SOURCE_OFFSET_PX;
    const tipX = pB[0] - uxPx * destOffsetPx;
    const tipY = pB[1] - uyPx * destOffsetPx;

    const d = buildArrowSvgPath(shaftStartX, shaftStartY, tipX, tipY);
    if (!d) { hide(); return; }
    lastLineD = setStrAttr(line, 'd', d, lastLineD);
    lastLineBgD = setStrAttr(lineBg, 'd', d, lastLineBgD);

    // True 3D distance, always shown regardless of clipping.
    const dx = tmpB.x - tmpA.x;
    const dy = tmpB.y - tmpA.y;
    const dz = tmpB.z - tmpA.z;
    const distPc = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Place the label just past the chevron tip — same offsets as the
    // Sol/GC arrows so the three reference arrows have identical label
    // geometry. When the tip is off-screen, anchor instead to where the
    // shaft visibly exits the viewport so the label stays attached to
    // the line rather than drifting to a clamped corner.
    const exit = viewportSegmentExit(pA[0], pA[1], tipX, tipY, w, h);
    const anchorX = exit ? exit[0] : tipX;
    const anchorY = exit ? exit[1] : tipY;
    if (!visible) {
      lastDistUiDisplay = setStyle(distUi, 'display', '', lastDistUiDisplay);
      visible = true;
    }
    const labelText = `${destLabel} · ${fmtDistAuto(distPc)}`;
    lastLabelText = setText(label, labelText, lastLabelText);
    // The label is anchor-start so `x` is its left edge; subtract its width
    // from the right-side clamp so the visible text stays inside the
    // viewport when the line exits near the right edge. Caching by text
    // content avoids the per-frame layout flush forced by getComputedTextLength.
    let labelWidth = labelWidthCache.px;
    if (labelText !== labelWidthCache.text) {
      labelWidth = label.getComputedTextLength();
      labelWidthCache.text = labelText;
      labelWidthCache.px = labelWidth;
    }
    const labelAnchorX = anchorX + ARROW_LABEL_OFFSET_PX + ARROW_HEAD_DEPTH_PX;
    const labelAnchorY = anchorY - ARROW_LABEL_OFFSET_PX;
    const mxMax = Math.max(ARROW_LABEL_PADDING_PX, w - ARROW_LABEL_PADDING_PX - labelWidth);
    const mx = Math.max(ARROW_LABEL_PADDING_PX, Math.min(mxMax, labelAnchorX));
    const my = Math.max(ARROW_LABEL_PADDING_PX, Math.min(h - ARROW_LABEL_PADDING_PX, labelAnchorY));
    lastLabelX = setNumAttr(label, 'x', mx, lastLabelX);
    lastLabelY = setNumAttr(label, 'y', my, lastLabelY);

    // Per-arrow disc-coverage fade — drops opacity to 0 as the focused
    // star's disc grows past THIS arrow's drawn shaft length. The
    // distance-vector is typically longer than the nominal Sol/GC
    // chevrons (it spans from focal star to its destination), so it
    // outlasts them — by design, per the ml8 bead's option B. The HUD
    // Sol/GC arrows compute their own shared alpha inside hud-overlay.ts
    // against `max(solShaftLen, gcShaftLen)`.
    //
    // discRadius = 0 when the source end is a cloud (no stellar disc) —
    // the fade is then alpha=1 (no disc-coverage problem to solve).
    // Likewise alpha=1 in steady-state observe mode (focal star isn't
    // centred so there's nothing to clear chrome out of the way for).
    //
    // Drawn-shaft length is the distance from shaftStart to tip (with
    // SOURCE_OFFSET_PX inset at the source end and the destination's
    // rendered silhouette inset at the tip end) — i.e., the visible line.
    const discRadiusPx = from.kind === 'star'
      ? renderedDiscPxAtPeak({
          catalog: stellata.catalog,
          idx: from.idx,
          camPos: stellata.camera.position,
          localPositions: stellata.localPositions,
          uniforms: stellata.uniforms,
        }) * 0.5
      : 0;
    const shaftDrawnLenPx = Math.hypot(tipX - shaftStartX, tipY - shaftStartY);
    const arrowAlpha = focusedArrowFadeAlpha(
      stellata.getCameraMode(),
      stellata.getObserveTransitionProgress(),
      discRadiusPx,
      shaftDrawnLenPx,
      SOURCE_OFFSET_PX,
    );
    // Pointer-events on the ui group go through the same helper
    // (suppressed below half-alpha so the barely-visible label doesn't
    // accept stray aim clicks).
    applyFade([line, lineBg, distUi], distUi, arrowAlpha, fadeState);
  });
}

export function projectWithNearClip(
  worldA: THREE.Vector3,
  worldB: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
  scratch?: ProjectScratch,
): { pA: [number, number]; pB: [number, number] } | null {
  const s = scratch ?? makeProjectScratch();
  s.va.copy(worldA).applyMatrix4(camera.matrixWorldInverse);
  s.vb.copy(worldB).applyMatrix4(camera.matrixWorldInverse);
  const threshold = -camera.near;

  // If the focus star itself is behind the camera, we can't draw a
  // meaningful origin — bail out.
  if (s.va.z >= threshold) return null;

  let endView = s.vb;
  if (s.vb.z >= threshold) {
    // Destination is behind the camera; clip the segment at the near plane
    // so the chevrons still extend toward where it would be.
    const denom = s.vb.z - s.va.z;
    if (Math.abs(denom) < 1e-9) return null;
    const t = (threshold - s.va.z) / denom;
    if (!(t > 0 && t <= 1)) return null;
    endView = s.end.copy(s.va).lerp(s.vb, t);
    endView.z = threshold - 1e-4;
  }

  const ndcA = s.va.applyMatrix4(camera.projectionMatrix);
  const ndcB = endView.applyMatrix4(camera.projectionMatrix);

  const pA: [number, number] = [
    (ndcA.x + 1) * 0.5 * w,
    (1 - ndcA.y) * 0.5 * h,
  ];
  const pB: [number, number] = [
    (ndcB.x + 1) * 0.5 * w,
    (1 - ndcB.y) * 0.5 * h,
  ];

  // Clip point can project to millions of pixels off-screen; rein it in so the
  // SVG path data stays reasonable while preserving the direction of travel.
  const maxOffset = Math.hypot(w, h) * MAX_OFFSCREEN_FACTOR;
  const dx = pB[0] - pA[0];
  const dy = pB[1] - pA[1];
  const len = Math.hypot(dx, dy);
  if (len > maxOffset && len > 0) {
    const scale = maxOffset / len;
    pB[0] = pA[0] + dx * scale;
    pB[1] = pA[1] + dy * scale;
  }

  return { pA, pB };
}

/**
 * Cache for SVG getComputedTextLength results. The key is the rendered
 * text alone; on a webfont load (FOUT/FOIT) the *same* text reflows to a
 * different pixel width, so the cache must be invalidated when the
 * webfonts settle — see attachFontsReadyInvalidation. Without that, the
 * right-edge clamp stays pinned to the fallback-font measurement for
 * the lifetime of the page (this bug).
 */
export interface LabelWidthCache {
  text: string;
  px: number;
}

export function makeLabelWidthCache(): LabelWidthCache {
  return { text: '', px: 0 };
}

/**
 * Attach a one-shot listener to document.fonts.ready that zeros the cache
 * so the next per-frame call re-measures with the loaded webfont. Settles
 * within a few hundred ms of page load (or fires immediately if all fonts
 * were already in cache). The try/catch + optional-chaining guard older
 * browsers where the Fonts API isn't present — the cache simply stays
 * text-keyed, which is the pre-fix behaviour.
 */
export function attachFontsReadyInvalidation(
  cache: LabelWidthCache,
  fonts: { ready?: Promise<unknown> } | undefined,
): void {
  try {
    fonts?.ready?.then(() => {
      cache.text = '';
      cache.px = 0;
    }).catch(() => { /* ignored: cache stays text-keyed */ });
  } catch {
    /* ignored: fonts API not available */
  }
}

// Liang-Barsky exit point: where does segment (ax,ay)→(bx,by) leave the
// viewport rectangle [0,w]×[0,h]? Returns the b-side intersection (largest
// t in [0,1] that touches the rect) when the segment crosses it, else null.
// Returns null when (bx,by) is already inside — caller treats that as
// "use (bx,by) as-is." Handles the case where (ax,ay) is also off-screen
// (extreme camera drag) by intersecting both ends of the segment with the
// rect; the meaningful t for label placement is the one nearest b.
export function viewportSegmentExit(
  ax: number, ay: number, bx: number, by: number,
  w: number, h: number,
): [number, number] | null {
  if (bx >= 0 && bx <= w && by >= 0 && by <= h) return null;
  const dx = bx - ax;
  const dy = by - ay;
  const ps = [-dx, dx, -dy, dy];
  const qs = [ax, w - ax, ay, h - ay];
  let tEnter = 0;
  let tExit = 1;
  for (let i = 0; i < 4; i++) {
    const p = ps[i];
    const q = qs[i];
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > tExit) return null;
      if (t > tEnter) tEnter = t;
    } else {
      if (t < tEnter) return null;
      if (t < tExit) tExit = t;
    }
  }
  if (tEnter > tExit) return null;
  return [ax + dx * tExit, ay + dy * tExit];
}

