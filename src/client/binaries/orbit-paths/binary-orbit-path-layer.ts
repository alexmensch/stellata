// Focus-gated orbital-path ellipses for the members of the focused
// multi-star system. See the folder README.

import * as THREE from 'three';
import type { MemberSphere } from '../../local-depth/bracket/slice-pure';
import { RING_EXTENT_MARGIN } from '../../solar-system/local-cluster-pure';
import { AU_PC } from '../../util/astronomy-constants';
import { type BinariesData } from '../binaries-loader';
import { keplerRelationParams, relationIndicesInBounds } from '../orbit-relation-cache';
import { keplerChainRelationIdxs, buildBinaryOrbitRingPoints } from './binary-orbit-path-pure';
import type { ChromeLineMaterial, ChromeLineMaterials } from '../../chrome-lines/chrome-line-materials';
import {
  makeOrbitLineLoop,
  ORBIT_LINE_SEGMENTS,
  ORBIT_LINE_COLOUR,
  ORBIT_LINE_OPACITY,
  pixelsPerRadian,
  angularRadiusPx,
} from '../../util/orbit-line';

// In-pass order (the group lives in the local depth pass, same slot the
// planet orbit rings use): after the member-star disc mirror (0) so the
// bracket z-buffer hides far-side arcs behind a resolved disc and draws
// near-side arcs over it; before the member glow (3.5), which adds on top.
const PATH_RENDER_ORDER = 3.2;
// Hide a pair once its larger ellipse subtends less than this on-screen
// radius: at that size the orbit no longer reads as a loop, and the focus
// ring (24 px) takes back over as the "you are here" marker.
const PATH_MIN_RADIUS_PX = 24;

const _offset = new THREE.Vector3();

/** The one thing this layer needs from the orbit walk: a pair's rendered
 *  relative offset `R(t)`. `BinaryOrbitField` satisfies it. */
export interface RelationOffsetSource {
  relationOffsetPcInto(relationIdx: number, out: THREE.Vector3): boolean;
}

interface OrbitPathPair {
  readonly relationIdx: number;
  readonly secondaryIdx: number;
  /** Secondary mass fraction M_s/(M_p+M_s); drives the barycentre split. */
  readonly q: number;
  /** Larger member's ellipse semi-major (pc) — the on-screen-size proxy
   *  for the per-frame visibility gate. */
  readonly charSizePc: number;
  /** Bounding radius (pc) of the pair's drawn ellipses about the
   *  barycentre — larger member's apoapsis plus margin. Feeds the local
   *  depth pass's slice bracket. */
  readonly extentPc: number;
  readonly group: THREE.Group;
  readonly primaryLoop: THREE.Line;
  readonly secondaryLoop: THREE.Line;
}

/**
 * One closed-line pair per Kepler relation on the focused star's chain —
 * each member's barycentric ellipse. Mirrors `OrbitRingsLayer`: an
 * event-driven rebuild (`setSystem` on focus change) plus a per-frame
 * barycentre reposition from the walked local positions.
 */
export class BinaryOrbitPathLayer {
  readonly group: THREE.Group;
  private stroke: ChromeLineMaterial;
  private pairs: OrbitPathPair[] = [];
  // Detail-cycle permission (floor 'representational'); false hides the
  // paths even while a system is focused.
  private permitted = true;
  // Whether the last update() left any pair above the on-screen-size gate.
  private anyVisible = false;

  constructor(chromeLines: ChromeLineMaterials) {
    this.group = new THREE.Group();
    this.group.renderOrder = PATH_RENDER_ORDER;
    this.group.visible = false;
    this.stroke = chromeLines.solid(ORBIT_LINE_COLOUR, ORBIT_LINE_OPACITY, true);
  }

  /**
   * Rebuild the paths for the focused system's Kepler pairs. Visual
   * companions (no elements) and unfocused systems yield none. Rebuilds
   * geometry — call on focus change, not per frame. `absolutePositions`
   * anchors each Tier-1 tangent basis at its system's ICRS direction.
   */
  setSystem(
    binaries: BinariesData | null,
    focalIdx: number | null,
    absolutePositions: Float32Array,
  ): void {
    this.disposePairs();
    if (binaries === null) {
      this.group.visible = false;
      return;
    }
    for (const ri of keplerChainRelationIdxs(binaries, focalIdx)) {
      const r = binaries.relations[ri];
      const params = keplerRelationParams(r);
      if (params === null) continue;
      if (!relationIndicesInBounds(r, absolutePositions.length)) continue;
      const pBase = r.primaryIdx * 3;
      const { primary, secondary } = buildBinaryOrbitRingPoints(
        params.elements,
        params.tier,
        { x: absolutePositions[pBase], y: absolutePositions[pBase + 1], z: absolutePositions[pBase + 2] },
        ORBIT_LINE_SEGMENTS,
      );
      const g = new THREE.Group();
      const primaryLoop = makeOrbitLineLoop(primary, this.stroke.material, this.group.renderOrder);
      const secondaryLoop =
        makeOrbitLineLoop(secondary, this.stroke.material, this.group.renderOrder);
      g.add(primaryLoop);
      g.add(secondaryLoop);
      this.group.add(g);
      const charSizePc = Math.max(params.elements.q, 1 - params.elements.q)
        * params.elements.a * AU_PC;
      this.pairs.push({
        relationIdx: ri,
        secondaryIdx: r.secondaryIdx,
        q: params.elements.q,
        charSizePc,
        extentPc: charSizePc * (1 + params.elements.e) * RING_EXTENT_MARGIN,
        group: g,
        primaryLoop,
        secondaryLoop,
      });
    }
    this.group.visible = this.permitted && this.pairs.length > 0;
  }

  /**
   * Per-frame barycentre reposition + on-screen-size visibility gate. Must
   * run AFTER `BinaryOrbitField.update()` writes this frame's slots, so
   * each ellipse rides its pair's live drift and the two members sit on
   * their own paths. A pair hides once its orbit shrinks below
   * `PATH_MIN_RADIUS_PX` (zoom-out / distant system), mirroring the planet
   * orbit rings' pixel gate.
   *
   * The barycentre comes off the secondary's slot and the walk's own
   * `R(t)`, NOT the mass-weighted average of the two slots: a hierarchical
   * outer pair shares its primary slot with an inner pair that splits it
   * again, and that average inherits the inner wobble the secondary never
   * saw. See README § Anchor.
   */
  update(
    offsets: RelationOffsetSource | null,
    localPositions: Float32Array,
    camera: THREE.PerspectiveCamera,
    viewportHeightPx: number,
  ): void {
    if (!this.permitted || this.pairs.length === 0) {
      this.group.visible = false;
      this.anyVisible = false;
      return;
    }
    this.group.visible = true;
    const pxPerRad = pixelsPerRadian(camera.fov, viewportHeightPx);
    let anyVisible = false;
    for (const p of this.pairs) {
      const sB = p.secondaryIdx * 3;
      if (offsets?.relationOffsetPcInto(p.relationIdx, _offset) !== true) {
        p.group.visible = false;
        continue;
      }
      const secondaryFrac = 1 - p.q;
      p.group.position.set(
        localPositions[sB] - secondaryFrac * _offset.x,
        localPositions[sB + 1] - secondaryFrac * _offset.y,
        localPositions[sB + 2] - secondaryFrac * _offset.z,
      );
      const dPc = camera.position.distanceTo(p.group.position);
      const visible = angularRadiusPx(p.charSizePc, dPc, pxPerRad) >= PATH_MIN_RADIUS_PX;
      p.group.visible = visible;
      if (visible) anyVisible = true;
    }
    this.anyVisible = anyVisible;
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.group.visible = false;
  }

  /**
   * True when at least one of the focused system's paths is drawn AND
   * large enough on screen to read as an orbit. The focus ring overlay
   * reads this (via `Stellata.anyOrbitRingVisible`) to suppress itself
   * while the paths mark the focal star — mirrors
   * `OrbitRingsLayer.anyOrbitRingVisible`. The star local cluster reads
   * it too: paths drawing engage the whole focal chain's mirror draws.
   */
  anyOrbitRingVisible(): boolean {
    return this.permitted && this.group.visible && this.anyVisible;
  }

  /** Append each drawn pair's barycentre-anchored extent sphere so the
   *  local depth pass's slice bracket contains the ellipses. Positions
   *  were set by this frame's `update()`. */
  collectSpheres(camera: THREE.PerspectiveCamera, out: MemberSphere[]): void {
    if (!this.anyOrbitRingVisible()) return;
    for (const p of this.pairs) {
      if (!p.group.visible) continue;
      out.push({
        distPc: camera.position.distanceTo(p.group.position),
        radiusPc: p.extentPc,
      });
    }
  }

  dispose(): void {
    this.disposePairs();
    this.stroke.dispose();
  }

  private disposePairs(): void {
    for (const p of this.pairs) {
      this.group.remove(p.group);
      p.primaryLoop.geometry.dispose();
      p.secondaryLoop.geometry.dispose();
    }
    this.pairs = [];
  }
}
