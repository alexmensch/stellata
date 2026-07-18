// Per-frame field that walks binary relations + perturbs star-pipeline
// positions. See src/client/binaries/README.md § Tier mapping + LOD.

import * as THREE from 'three';
import { ARCSEC_TO_RAD } from '../util/astronomy-constants';
import { tToJDE } from '../solar-system/time';
import { jdeToJulianEpochYear, writeAdvancedLocal } from '../loaders/epoch-advance-pure';
import { NO_PARENT, type BinariesData, type BinaryRelation } from './binaries-loader';
import {
  buildOrbitRelationCaches,
  evaluateOrbitRelationDeltaPc,
  type OrbitRelationCache,
} from './orbit-relation-cache';
import {
  SUB_PIXEL_THRESHOLD_PX,
  VISIBILITY_HORIZON_PC,
} from './binary-tuning';
import { apparentMagnitude, SOFT_TAPER_MARGIN_MAG } from '../solar-system/perceptual-magnitude';

export interface BinaryOrbitFieldOptions {
  binaries: BinariesData;
  /** Catalog-wide absolute ICRS positions, length = catalog.count * 3.
   *  Read-only inside this field. The primary's slot is the per-star
   *  catalog baseline + the Tier-1 tangent-basis anchor; the pair's
   *  RELATIVE offset does NOT come from subtracting two slots (that
   *  float32 diff carries WDS/Kepler placement disagreement) — it rides
   *  on `OrbitRelationCache.baseDiffPc` + ΔR(t). */
  absolutePositions: Float32Array;
  /** Immutable J2016.0 catalog baseline (count × 3) + per-star space-motion
   *  velocities (pc/yr). Off-focal-chain relations reset their local slots
   *  from `(base + v·Δt) − worldOffset` in float64 rather than from the
   *  float32 `absolutePositions`, so a drifting unfocused system doesn't
   *  snap onto the ~0.4 AU float32 absolute grid under time scrub. See
   *  § Walk-active LOD. */
  basePositions: Float32Array;
  velocities: Float32Array;
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

interface SlotPert { x: number; y: number; z: number }

export class BinaryOrbitField {
  private opts: BinaryOrbitFieldOptions;
  private worldOffset = new THREE.Vector3();
  private relations: OrbitRelationCache[] = [];

  // Relations (by BinariesData.relations index) on the current focal
  // star's slot-chain — every relation that writes the focal's slot
  // (focal as primary or secondary) plus their parentRelation ancestors.
  // Rebuilt only when the focal index changes. Members bypass all LOD
  // gates so the focal-frame ride reads a continuous perturbation.
  private focalChainRelIdx = new Set<number>();
  private focalChainIdx: number | null = null;
  // Per-slot float64 perturbation accumulators, reused by
  // focalPerturbationInto across frames (cleared per call).
  private slotPert = new Map<number, SlotPert>();

  // Static-frame skip state. When the previous update() evaluated zero
  // Kepler relations (everything gated out or sub-pixel-suppressed),
  // every buffer write is a pure function of the inputs below — an
  // update() with identical inputs would rewrite identical values, so
  // both the walk and the attribute re-uploads are skipped. Poisoned so
  // the first update() always runs; recenter()/markBaselinesDirty()
  // re-poison when the baselines the writes derive from move.
  private baselinesDirty = true;
  private lastKeplerCount = -1;
  private lastActiveCount = 0;
  private lastCamPos = new THREE.Vector3(NaN, NaN, NaN);
  private lastMaxAppMag = NaN;
  private lastViewportPx = NaN;
  private lastFovYRad = NaN;
  private lastFocalIdx: number | null = null;

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
    this.baselinesDirty = true;
  }

  /** Force the next update() to walk + re-upload even when the static-
   *  frame skip would otherwise fire. The integration shell calls this
   *  whenever it rewrites `localPositions` wholesale (epoch re-advance,
   *  origin recentre) — those writes park every slot at its bare
   *  baseline, and the walk must re-apply the suppressed secondaries'
   *  `baseDiffPc` placements on top. */
  markBaselinesDirty(): void {
    this.baselinesDirty = true;
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
    if (
      !this.baselinesDirty
      && this.lastKeplerCount === 0
      && focalIdx === this.lastFocalIdx
      && maxAppMag === this.lastMaxAppMag
      && viewportPx === this.lastViewportPx
      && fovYRad === this.lastFovYRad
      && cameraPos.equals(this.lastCamPos)
    ) {
      return this.lastActiveCount;
    }

    const tJd = tToJDE(t);
    this.ensureFocalChain(focalIdx);
    let keplerCount = 0;
    const pxPerRad = viewportPx / Math.max(fovYRad, 1e-9);
    const wox = this.worldOffset.x;
    const woy = this.worldOffset.y;
    const woz = this.worldOffset.z;
    const abs = this.opts.absolutePositions;
    const base = this.opts.basePositions;
    const vel = this.opts.velocities;
    const epochJyr = jdeToJulianEpochYear(tJd);
    const local = this.opts.localPositions;
    const suppress = this.opts.compositeSuppress;
    const absMags = this.opts.absoluteMags;
    let activeCount = 0;

    for (let i = 0; i < this.relations.length; i++) {
      const rc = this.relations[i];
      const r = this.opts.binaries.relations[rc.relationIdx];
      const pIdx = r.primaryIdx;
      const sIdx = r.secondaryIdx;

      // Reset to the systemic baseline (minus worldOffset) and clear
      // suppress so transient active→inactive transitions don't leave stale
      // state behind. This also restores the parent-perturbation baseline
      // for hierarchical walks — the inner-pair pass below ADDs onto the
      // slot the outer pass wrote first.
      //
      // Unfocused, reconstruct that baseline in float64 from the exact epoch
      // (writeAdvancedLocal off base + velocities): subtracting the origin
      // from the float32 absolute instead snaps the pair onto the ~0.4 AU
      // absolute grid as it drifts under scrub — the "whole system teleports"
      // bug. When a star is focused the whole scene rides the absolute: the
      // shell's epoch-follow moves the camera by the focal's abs delta, and
      // every hierarchy slot must share that absolute so the two cancel and
      // the focal stays pinned. See § Walk-active LOD.
      const pBase = pIdx * 3;
      const sBase = sIdx * 3;
      if (focalIdx !== null) {
        local[pBase + 0] = abs[pBase + 0] - wox;
        local[pBase + 1] = abs[pBase + 1] - woy;
        local[pBase + 2] = abs[pBase + 2] - woz;
        local[sBase + 0] = abs[sBase + 0] - wox;
        local[sBase + 1] = abs[sBase + 1] - woy;
        local[sBase + 2] = abs[sBase + 2] - woz;
      } else {
        writeAdvancedLocal(base, vel, epochJyr, pBase, wox, woy, woz, local);
        writeAdvancedLocal(base, vel, epochJyr, sBase, wox, woy, woz, local);
      }
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

      // Relations on the focal star's slot-chain bypass all three LOD
      // gates (horizon, magnitude, sub-pixel). Their ΔR feeds the
      // focal-frame ride, which the camera tracks per frame; a gate
      // firing mid-focus would snap the focal to its baseline and jolt
      // the camera. Non-chain relations gate freely — they cannot touch
      // the focal's slot.
      const onFocalChain = focalIdx !== null && this.focalChainRelIdx.has(rc.relationIdx);
      if (!onFocalChain) {
        // Primary's camera distance — magnitude + horizon filters share it.
        const dx = aPx - cameraPos.x;
        const dy = aPy - cameraPos.y;
        const dz = aPz - cameraPos.z;
        const dCamPc = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dCamPc > VISIBILITY_HORIZON_PC) continue;
        const appMag = apparentMagnitude(absMags[pIdx], dCamPc);
        if (appMag > maxAppMag + SOFT_TAPER_MARGIN_MAG) continue;
        activeCount++;
        // Peak angular separation envelope. AU / pc converts to arcsec
        // because 1 AU subtends 1″ at 1 pc by definition.
        const peakArcsec = rc.peakSepAU / Math.max(dCamPc, 1e-30);
        const peakPx = peakArcsec * ARCSEC_TO_RAD * pxPerRad;
        if (peakPx < SUB_PIXEL_THRESHOLD_PX) {
          // Composite suppression: skip Kepler, mark the secondary so the
          // close-range + depth-mask passes drop its quad. Collapse it onto
          // the primary's CURRENT slot + baseDiffPc (drop only the sub-pixel
          // ΔR) — same anchor as the active walk, so crossing the gate never
          // steps the secondary by baseDiffPc − bakedDiff. aPx carries any
          // parent perturbation, which the secondary inherits.
          suppress[sIdx] = 1;
          local[sBase + 0] = aPx + rc.baseDiffPc.x;
          local[sBase + 1] = aPy + rc.baseDiffPc.y;
          local[sBase + 2] = aPz + rc.baseDiffPc.z;
          continue;
        }
      } else {
        activeCount++;
      }

      // Barycentric split (sCoeff − pCoeff = 1): primary += −q·ΔR, secondary
      // tracks primary + baseDiffPc + ΔR. aPx carries any parent
      // perturbation, so a hierarchical inner pair inherits it on both
      // members while its relative offset stays clean. See README § Tier
      // mapping + § Hierarchical walk.
      this.evaluateDelta(rc, r, tJd);
      keplerCount++;
      const dxDelta = DELTA_OUT.x;
      const dyDelta = DELTA_OUT.y;
      const dzDelta = DELTA_OUT.z;
      const pCoeff = -rc.elements.q;
      local[pBase + 0] = aPx + dxDelta * pCoeff;
      local[pBase + 1] = aPy + dyDelta * pCoeff;
      local[pBase + 2] = aPz + dzDelta * pCoeff;
      local[sBase + 0] = local[pBase + 0] + rc.baseDiffPc.x + dxDelta;
      local[sBase + 1] = local[pBase + 1] + rc.baseDiffPc.y + dyDelta;
      local[sBase + 2] = local[pBase + 2] + rc.baseDiffPc.z + dzDelta;
    }

    this.opts.iPositionAttr.needsUpdate = true;
    this.opts.iCompositeSuppressAttr.needsUpdate = true;
    this.baselinesDirty = false;
    this.lastKeplerCount = keplerCount;
    this.lastActiveCount = activeCount;
    this.lastCamPos.copy(cameraPos);
    this.lastMaxAppMag = maxAppMag;
    this.lastViewportPx = viewportPx;
    this.lastFovYRad = fovYRad;
    this.lastFocalIdx = focalIdx;
    return activeCount;
  }

  /** Total float64 perturbation of the focal star's slot from its catalog
   *  baseline at time `t`, written into `out`. Returns false (and zeros
   *  `out`) when the focal is in no orbit relation. Equals the walk's
   *  written `localPositions[focal] − baselineLocal` within float32
   *  quantization and is continuous in `t`.
   *
   *  Drives the focal-frame ride in the integration shell: the camera
   *  tracks this displacement so the pinned star stays glued to NDC
   *  centre without the walk rebasing its slot. Independent of `update()`
   *  — replays the focal chain in float64 (chain length ≤ 3) so the ride
   *  never accumulates float32 grid noise into the camera. */
  focalPerturbationInto(focalIdx: number, t: number, out: THREE.Vector3): boolean {
    this.ensureFocalChain(focalIdx);
    out.set(0, 0, 0);
    if (this.focalChainRelIdx.size === 0) return false;
    const tJd = tToJDE(t);
    const abs = this.opts.absolutePositions;
    this.slotPert.clear();
    for (let i = 0; i < this.relations.length; i++) {
      const rc = this.relations[i];
      if (!this.focalChainRelIdx.has(rc.relationIdx)) continue;
      const r = this.opts.binaries.relations[rc.relationIdx];
      const pIdx = r.primaryIdx;
      const sIdx = r.secondaryIdx;
      const pBase = pIdx * 3;
      const sBase = sIdx * 3;
      this.evaluateDelta(rc, r, tJd);
      // Primary accumulates −q·ΔR onto whatever a parent relation already
      // wrote into its slot; the secondary tracks primary + baseDiffPc +
      // ΔR. Same formulas the float32 walk applies, in topological order.
      // The secondary's DISPLACEMENT from its baked baseline picks up
      // corr = baseDiffPc − bakedDiff — the elements-alone anchor moving
      // it off the (possibly disagreeing) baked WDS placement — so the
      // ride keeps controls.target on the star even when the focal is a
      // secondary of a mismatched pair.
      const q = rc.elements.q;
      const pPrev = this.slotPert.get(pIdx);
      const px = (pPrev ? pPrev.x : 0) - DELTA_OUT.x * q;
      const py = (pPrev ? pPrev.y : 0) - DELTA_OUT.y * q;
      const pz = (pPrev ? pPrev.z : 0) - DELTA_OUT.z * q;
      if (pPrev) { pPrev.x = px; pPrev.y = py; pPrev.z = pz; }
      else this.slotPert.set(pIdx, { x: px, y: py, z: pz });
      const sPrev = this.slotPert.get(sIdx);
      const sx = px + DELTA_OUT.x + (rc.baseDiffPc.x - (abs[sBase + 0] - abs[pBase + 0]));
      const sy = py + DELTA_OUT.y + (rc.baseDiffPc.y - (abs[sBase + 1] - abs[pBase + 1]));
      const sz = pz + DELTA_OUT.z + (rc.baseDiffPc.z - (abs[sBase + 2] - abs[pBase + 2]));
      if (sPrev) { sPrev.x = sx; sPrev.y = sy; sPrev.z = sz; }
      else this.slotPert.set(sIdx, { x: sx, y: sy, z: sz });
    }
    const fp = this.slotPert.get(focalIdx);
    if (!fp) return false;
    out.set(fp.x, fp.y, fp.z);
    return true;
  }

  dispose(): void {
    // No GPU/three.js resources held internally — the star pipeline
    // owns the attribute lifecycle. Method exists for parity with the
    // other field classes' lifecycle contract.
    this.focalChainRelIdx.clear();
    this.focalChainIdx = null;
    this.slotPert.clear();
    this.baselinesDirty = true;
    this.lastKeplerCount = -1;
    this.lastCamPos.set(NaN, NaN, NaN);
  }

  // ── private ─────────────────────────────────────────────────────────

  /** Rebuild `focalChainRelIdx` when the focal index changes. The chain
   *  is every relation writing the focal's slot (focal as primary or
   *  secondary) plus their `parentRelation` ancestors, so the mini-walk
   *  and the LOD-gate exemption both see every relation that contributes
   *  to the focal's rendered position. */
  private ensureFocalChain(focalIdx: number | null): void {
    if (focalIdx === this.focalChainIdx) return;
    this.focalChainIdx = focalIdx;
    this.focalChainRelIdx.clear();
    if (focalIdx === null) return;
    const bin = this.opts.binaries;
    const stack: number[] = [];
    const primRels = bin.primaryIdxToRelations.get(focalIdx);
    if (primRels) for (const ri of primRels) stack.push(ri);
    const secRels = bin.secondaryIdxToRelations.get(focalIdx);
    if (secRels) for (const ri of secRels) stack.push(ri);
    while (stack.length > 0) {
      const ri = stack.pop() as number;
      if (this.focalChainRelIdx.has(ri)) continue;
      this.focalChainRelIdx.add(ri);
      const parent = bin.relations[ri].parentRelation;
      if (parent !== NO_PARENT) stack.push(parent);
    }
  }

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
