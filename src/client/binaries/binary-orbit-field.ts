// Per-frame field that walks binary relations + perturbs star-pipeline
// positions. See src/client/binaries/README.md § Tier mapping + LOD.

import * as THREE from 'three';
import { ARCSEC_TO_RAD, J2000_JD } from '../util/astronomy-constants';
import { tToJDE } from '../solar-system/time';
import {
  evaluateOrbitSkyAU,
  evaluateOrbitInPlaneAU,
  evaluateOrbitDeltaPcTier1,
  evaluateOrbitDeltaPcTier2,
  type OrbitalElements,
} from './binary-orbit-pure';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  type BinariesData,
  type BinaryRelation,
} from './binaries-loader';
import {
  SUB_PIXEL_THRESHOLD_PX,
  VISIBILITY_HORIZON_PC,
} from './binary-tuning';

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

/** Per-relation cache populated at construction. Cheap to keep — at
 *  ~900 binary records the whole list is well under 100 KB. */
interface RelationCache {
  /** Index back into `BinariesData.relations`. */
  relationIdx: number;
  /** Tier (1 or 2). Tier 3 records aren't cached; they never animate. */
  tier: 1 | 2;
  /** Orbital elements pulled from the relation, in the units the pure
   *  layer expects. */
  elements: OrbitalElements;
  /** Tier-1 R(baseline) cached so per-frame eval is a single Kepler
   *  solve (now) plus a subtract. Baseline = the relation's
   *  sepPaEpochJd (the epoch the stored catalog separation was
   *  measured at), J2000 when the record carries no epoch.
   *  {northAU, eastAU} for Tier 1. */
  refSkyAU: { northAU: number; eastAU: number } | null;
  /** Tier-2 R(baseline) cached. {xAU, yAU} in the orbit plane. */
  refInPlaneAU: { xAU: number; yAU: number } | null;
  /** Peak relative-separation envelope, AU. a · (1 + e). Used by the
   *  screen-separation LOD as the worst-case sub-pixel test. */
  peakSepAU: number;
}

const DELTA_OUT: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
const SYSTEM_XYZ: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

export class BinaryOrbitField {
  private opts: BinaryOrbitFieldOptions;
  private worldOffset = new THREE.Vector3();
  private relations: RelationCache[] = [];

  constructor(opts: BinaryOrbitFieldOptions) {
    this.opts = opts;
    this.buildCache();
  }

  /** Read-only access to the cached relation list. Tests and the
   *  reflection sweep import this to iterate active orbital pairs
   *  without re-parsing binaries.bin. */
  get cachedRelations(): readonly RelationCache[] {
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
      const appMag = absMags[pIdx] + 5 * (Math.log10(Math.max(dCamPc, 1e-30)) - 1);
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

  private buildCache(): void {
    const relations = this.opts.binaries.relations;
    const abs = this.opts.absolutePositions;
    for (let i = 0; i < relations.length; i++) {
      const r = relations[i];
      if ((r.flags & FLAG_HAS_ORBIT) === 0) continue;
      // binaries.bin invariant restated at the consumer: has_orbit=1
      // implies all elements needed for ΔR(t) are finite (P, T, e, a,
      // ω, q — i and Ω fall back to 0 in relationToElements). A record
      // that violates that contract would drive evaluateDelta to NaN
      // ΔR every frame and update() would write NaN into
      // localPositions[primaryIdx], poisoning every downstream
      // consumer of the primary's position. Skip the cache entry so
      // the relation stays at its J2000 baseline.
      if (
        !Number.isFinite(r.q) || !Number.isFinite(r.aAU)
        || !Number.isFinite(r.e) || !Number.isFinite(r.pDays)
        || !Number.isFinite(r.tJd) || !Number.isFinite(r.omegaRad)
      ) continue;
      const tier: 1 | 2 = (r.flags & FLAG_HAS_INCLINATION) !== 0 ? 1 : 2;
      const elements = relationToElements(r);
      // The stored catalog separation is at the record's sep+PA epoch
      // (Gaia J2016 / WDS date_last), NOT J2000 — subtracting R(J2000)
      // would displace the whole rendered orbit by R(epoch) − R(J2000).
      const baselineJd = Number.isFinite(r.sepPaEpochJd)
        ? r.sepPaEpochJd
        : J2000_JD;
      let refSkyAU: { northAU: number; eastAU: number } | null = null;
      let refInPlaneAU: { xAU: number; yAU: number } | null = null;
      if (tier === 1) {
        refSkyAU = evaluateOrbitSkyAU(elements, baselineJd);
      } else {
        refInPlaneAU = evaluateOrbitInPlaneAU(elements, baselineJd);
      }
      const peakSepAU = elements.a * (1 + elements.e);
      if (r.primaryIdx * 3 + 2 >= abs.length || r.secondaryIdx * 3 + 2 >= abs.length) continue;
      this.relations.push({
        relationIdx: i,
        tier,
        elements,
        refSkyAU,
        refInPlaneAU,
        peakSepAU,
      });
    }
  }

  private evaluateDelta(
    rc: RelationCache,
    r: BinaryRelation,
    tJd: number,
  ): void {
    let v: { x: number; y: number; z: number };
    if (rc.tier === 1) {
      const abs = this.opts.absolutePositions;
      const pBase = r.primaryIdx * 3;
      SYSTEM_XYZ.x = abs[pBase + 0];
      SYSTEM_XYZ.y = abs[pBase + 1];
      SYSTEM_XYZ.z = abs[pBase + 2];
      v = evaluateOrbitDeltaPcTier1(rc.elements, rc.refSkyAU!, tJd, SYSTEM_XYZ);
    } else {
      v = evaluateOrbitDeltaPcTier2(rc.elements, rc.refInPlaneAU!, tJd);
    }
    DELTA_OUT.x = v.x;
    DELTA_OUT.y = v.y;
    DELTA_OUT.z = v.z;
  }
}

function relationToElements(r: BinaryRelation): OrbitalElements {
  // NaN-safe defaults for Tier 2 where Ω may be absent — the Tier 2
  // path ignores Ω entirely, so a NaN would silently propagate into
  // unused math but it's cleaner to zero it for log/debug clarity.
  return {
    P: r.pDays,
    T: r.tJd,
    e: r.e,
    a: r.aAU,
    i: Number.isFinite(r.iRad) ? r.iRad : 0,
    omega: Number.isFinite(r.omegaRad) ? r.omegaRad : 0,
    Omega: Number.isFinite(r.OmegaRad) ? r.OmegaRad : 0,
    q: r.q,
  };
}
