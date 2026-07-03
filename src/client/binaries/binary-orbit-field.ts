// Per-frame field that walks binary relations + perturbs star-pipeline
// positions. See src/client/binaries/README.md § Tier mapping + LOD.

import * as THREE from 'three';
import { ARCSEC_TO_RAD } from '../util/astronomy-constants';
import { tToJDE } from '../solar-system/time';
import { type BinariesData, type BinaryRelation } from './binaries-loader';
import {
  buildOrbitRelationCaches,
  evaluateOrbitRelationDeltaPc,
  type OrbitRelationCache,
} from './orbit-relation-cache';
import {
  SUB_PIXEL_THRESHOLD_PX,
  VISIBILITY_HORIZON_PC,
} from './binary-tuning';
import { apparentMagnitude } from '../solar-system/perceptual-magnitude';

export interface BinaryOrbitFieldOptions {
  binaries: BinariesData;
  /** Catalog-wide absolute ICRS positions, length = catalog.count * 3.
   *  Read-only inside this field — the source of truth for each star's
   *  catalog baseline (stored at the pair's sep+PA epoch). */
  absolutePositions: Float32Array;
  /** Catalog-wide absolute magnitudes, length = catalog.count. Drives
   *  the per-relation primary-visibility LOD. */
  absoluteMags: Float32Array;
  /** Per-instance local-frame positions; the star pipeline's
   *  `iPosition` attribute backs this buffer. Mutated in-place each
   *  frame for active relations. */
  localPositions: Float32Array;
  /** Per-instance composite-suppress flag. 1.0 means the close-range
   *  disc + core depth-mask passes skip this instance; the additive
   *  glow pass still runs so the two near-coincident point sources sum
   *  brightness correctly. Mutated in-place each frame. */
  compositeSuppress: Float32Array;
  /** Star-pipeline attributes the field flushes after each update(). */
  iPositionAttr: THREE.InstancedBufferAttribute;
  iCompositeSuppressAttr: THREE.InstancedBufferAttribute;
}

const DELTA_OUT: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
const SYSTEM_XYZ: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

export class BinaryOrbitField {
  private opts: BinaryOrbitFieldOptions;
  private worldOffset = new THREE.Vector3();
  private relations: OrbitRelationCache[] = [];

  constructor(opts: BinaryOrbitFieldOptions) {
    this.opts = opts;
    this.relations = buildOrbitRelationCaches(
      opts.binaries,
      opts.absolutePositions,
    );
  }

  /** Read-only access to the cached relation list. Tests and the
   *  reflection sweep import this to iterate active orbital pairs
   *  without re-parsing binaries.bin. */
  get cachedRelations(): readonly OrbitRelationCache[] {
    return this.relations;
  }

  /** Refresh the world-origin offset used to convert absolute positions
   *  to local-frame each frame. `Stellata.recenterOrigin` calls this so
   *  the next `update()` writes positions in the new local frame.
   *  Cheap — just a vector copy; per-frame work already pulls the
   *  offset for every active relation. */
  recenter(newOrigin: Readonly<THREE.Vector3>): void {
    this.worldOffset.copy(newOrigin);
  }

  /** Per-frame walk + perturbation pass.
   *
   *  - `maxAppMag` is the magnitude slider — relations whose primary
   *    sits below it (m_app > maxAppMag + 0.5, matching the shader's
   *    soft-taper kill) skip Kepler eval entirely.
   *  - `viewportPx` is the GL canvas's pixel height; `fovYRad` the
   *    camera's vertical field of view. Together they convert an angle
   *    in radians to pixels: `pxPerRad = viewportPx / fovYRad`.
   *
   *  Returns the count of relations that cleared the magnitude + horizon
   *  visibility filters this frame, including those collapsed by the
   *  screen-separation gate. Surfaced for test assertions on the LOD
   *  cascade; the runtime caller ignores it. */
  update(
    t: number,
    cameraPos: Readonly<THREE.Vector3>,
    maxAppMag: number,
    viewportPx: number,
    fovYRad: number,
    focalIdx: number | null = null,
  ): number {
    const tJd = tToJDE(t);
    const pxPerRad = viewportPx / Math.max(fovYRad, 1e-9);
    const wox = this.worldOffset.x;
    const woy = this.worldOffset.y;
    const woz = this.worldOffset.z;
    const abs = this.opts.absolutePositions;
    const local = this.opts.localPositions;
    const suppress = this.opts.compositeSuppress;
    const absMags = this.opts.absoluteMags;
    let activeCount = 0;

    for (let i = 0; i < this.relations.length; i++) {
      const rc = this.relations[i];
      const r = this.opts.binaries.relations[rc.relationIdx];
      const pIdx = r.primaryIdx;
      const sIdx = r.secondaryIdx;

      // Reset to catalog-baseline-minus-worldOffset and clear suppress so transient
      // active→inactive transitions don't leave stale state behind. This
      // also restores the parent-perturbation baseline for hierarchical
      // walks — the inner-pair pass below ADDs onto the slot the outer
      // pass wrote first.
      const pBase = pIdx * 3;
      const sBase = sIdx * 3;
      const aPx = abs[pBase + 0] - wox;
      const aPy = abs[pBase + 1] - woy;
      const aPz = abs[pBase + 2] - woz;
      local[pBase + 0] = aPx;
      local[pBase + 1] = aPy;
      local[pBase + 2] = aPz;
      local[sBase + 0] = abs[sBase + 0] - wox;
      local[sBase + 1] = abs[sBase + 1] - woy;
      local[sBase + 2] = abs[sBase + 2] - woz;
      suppress[sIdx] = 0;
    }

    for (let i = 0; i < this.relations.length; i++) {
      const rc = this.relations[i];
      const r = this.opts.binaries.relations[rc.relationIdx];
      const pIdx = r.primaryIdx;
      const sIdx = r.secondaryIdx;
      const pBase = pIdx * 3;
      const sBase = sIdx * 3;

      // Primary's CURRENT local position (may have been perturbed by a
      // parent relation earlier in this walk).
      const aPx = local[pBase + 0];
      const aPy = local[pBase + 1];
      const aPz = local[pBase + 2];

      // Primary's camera distance — magnitude + horizon filters share it.
      const dx = aPx - cameraPos.x;
      const dy = aPy - cameraPos.y;
      const dz = aPz - cameraPos.z;
      const dCamPc = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dCamPc > VISIBILITY_HORIZON_PC) continue;
      const appMag = apparentMagnitude(absMags[pIdx], dCamPc);
      if (appMag > maxAppMag + 0.5) continue;

      // Peak angular separation envelope. AU / pc converts to arcsec
      // because 1 AU subtends 1″ at 1 pc by definition.
      const peakArcsec = rc.peakSepAU / Math.max(dCamPc, 1e-30);
      const peakPx = peakArcsec * ARCSEC_TO_RAD * pxPerRad;
      activeCount++;
      if (peakPx < SUB_PIXEL_THRESHOLD_PX) {
        // Composite suppression: skip Kepler, mark the secondary so the
        // close-range + depth-mask passes drop its quad.
        suppress[sIdx] = 1;
        continue;
      }

      // Evaluate ΔR(t) for this relation per tier and apply.
      this.evaluateDelta(rc, r, tJd);
      const dxDelta = DELTA_OUT.x;
      const dyDelta = DELTA_OUT.y;
      const dzDelta = DELTA_OUT.z;
      // Focus-aware rebase: when the focal star is a member of this pair,
      // anchor it at (0,0,0) and put the FULL relative motion on the
      // companion. The disc shader's uPinFocusToCenter pins the focused
      // instance to NDC origin; without this rebase, _localPositions[focal]
      // drifts to a non-zero perturbation and overlays (focus ring,
      // distance vector, hover) project to a point separated from the
      // rendered disc.
      if (focalIdx === sIdx) {
        // Pin secondary at its catalog baseline. For an inner pair sharing
        // its primary with a parent relation, aPx carries the parent's
        // accumulated perturbation; using baseline_pri (not aPx) as the
        // primary's anchor lets the focal-pin absorb the parent's
        // barycentric shift, which is the physical truth (the inner pair
        // moves rigidly under the outer barycentre).
        local[pBase + 0] = (abs[pBase + 0] - wox) - dxDelta;
        local[pBase + 1] = (abs[pBase + 1] - woy) - dyDelta;
        local[pBase + 2] = (abs[pBase + 2] - woz) - dzDelta;
        local[sBase + 0] = abs[sBase + 0] - wox;
        local[sBase + 1] = abs[sBase + 1] - woy;
        local[sBase + 2] = abs[sBase + 2] - woz;
      } else {
        // pCoeff drives the primary's perturbation; the secondary then
        // tracks the primary's resulting position plus the absolute
        // baseline separation plus the full orbital ΔR. The barycentric
        // split (sCoeff = 1 − q for non-focal) and focal-rebase (sCoeff = 1
        // for focal=primary) both fall out of this formulation without
        // a second coefficient: sCoeff − pCoeff = 1 in every regime.
        // Hierarchical inner pairs propagate cleanly — aPx carries the
        // parent's perturbation, so both the inner primary AND inner
        // secondary inherit it, and the inner pair's relative offset
        // stays clean of the outer perturbation.
        const pCoeff = focalIdx === pIdx ? 0 : -rc.elements.q;
        local[pBase + 0] = aPx + dxDelta * pCoeff;
        local[pBase + 1] = aPy + dyDelta * pCoeff;
        local[pBase + 2] = aPz + dzDelta * pCoeff;
        local[sBase + 0] = local[pBase + 0] + (abs[sBase + 0] - abs[pBase + 0]) + dxDelta;
        local[sBase + 1] = local[pBase + 1] + (abs[sBase + 1] - abs[pBase + 1]) + dyDelta;
        local[sBase + 2] = local[pBase + 2] + (abs[sBase + 2] - abs[pBase + 2]) + dzDelta;
      }
    }

    this.opts.iPositionAttr.needsUpdate = true;
    this.opts.iCompositeSuppressAttr.needsUpdate = true;
    return activeCount;
  }

  dispose(): void {
    // No GPU/three.js resources held internally — the star pipeline
    // owns the attribute lifecycle. Method exists for parity with the
    // other field classes' lifecycle contract.
  }

  // ── private ─────────────────────────────────────────────────────────

  private evaluateDelta(
    rc: OrbitRelationCache,
    r: BinaryRelation,
    tJd: number,
  ): void {
    const abs = this.opts.absolutePositions;
    const pBase = r.primaryIdx * 3;
    SYSTEM_XYZ.x = abs[pBase + 0];
    SYSTEM_XYZ.y = abs[pBase + 1];
    SYSTEM_XYZ.z = abs[pBase + 2];
    const v = evaluateOrbitRelationDeltaPc(rc, tJd, SYSTEM_XYZ);
    DELTA_OUT.x = v.x;
    DELTA_OUT.y = v.y;
    DELTA_OUT.z = v.z;
  }
}
