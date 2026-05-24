// Per-frame field that walks binary relations + perturbs star-pipeline
// positions. See src/client/binaries/README.md § Tier mapping + LOD.

import * as THREE from 'three';
import { AU_PC, ARCSEC_TO_RAD, J2000_JD } from '../util/astronomy-constants';
import { tToJDE } from '../solar-system/time';
import {
  evaluateOrbitSkyAU,
  evaluateOrbitInPlaneAU,
  projectSkyToICRS,
  projectGalacticPlaneToICRS,
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
   *  J2000 baseline. */
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
  /** Tier-1 R(J2000) cached so per-frame eval is a single Kepler solve
   *  (now) plus a subtract. {northAU, eastAU} for Tier 1. */
  refSkyAU: { northAU: number; eastAU: number } | null;
  /** Tier-2 R(J2000) cached. {xAU, yAU} in the orbit plane. */
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
   *  Returns the number of relations that passed both visibility
   *  filters this frame — perf-hud uses this. */
  update(
    t: number,
    cameraPos: Readonly<THREE.Vector3>,
    maxAppMag: number,
    viewportPx: number,
    fovYRad: number,
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

      // Reset to J2000-minus-worldOffset and clear suppress so transient
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
      const q = rc.elements.q;
      const minusQ = -q;
      const oneMinusQ = 1 - q;
      local[pBase + 0] = aPx + dxDelta * minusQ;
      local[pBase + 1] = aPy + dyDelta * minusQ;
      local[pBase + 2] = aPz + dzDelta * minusQ;
      // Secondary's slot still holds the J2000-minus-worldOffset baseline
      // from the reset pass above; secondary moves additively from there.
      local[sBase + 0] += dxDelta * oneMinusQ;
      local[sBase + 1] += dyDelta * oneMinusQ;
      local[sBase + 2] += dzDelta * oneMinusQ;
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
      const tier: 1 | 2 = (r.flags & FLAG_HAS_INCLINATION) !== 0 ? 1 : 2;
      const elements = relationToElements(r);
      let refSkyAU: { northAU: number; eastAU: number } | null = null;
      let refInPlaneAU: { xAU: number; yAU: number } | null = null;
      if (tier === 1) {
        refSkyAU = evaluateOrbitSkyAU(elements, J2000_JD);
      } else {
        refInPlaneAU = evaluateOrbitInPlaneAU(elements, J2000_JD);
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
    if (rc.tier === 1) {
      const now = evaluateOrbitSkyAU(rc.elements, tJd);
      const ref = rc.refSkyAU!;
      const dnPc = (now.northAU - ref.northAU) * AU_PC;
      const dePc = (now.eastAU - ref.eastAU) * AU_PC;
      const abs = this.opts.absolutePositions;
      const pBase = r.primaryIdx * 3;
      SYSTEM_XYZ.x = abs[pBase + 0];
      SYSTEM_XYZ.y = abs[pBase + 1];
      SYSTEM_XYZ.z = abs[pBase + 2];
      const v = projectSkyToICRS(SYSTEM_XYZ, dnPc, dePc);
      DELTA_OUT.x = v.x;
      DELTA_OUT.y = v.y;
      DELTA_OUT.z = v.z;
    } else {
      const now = evaluateOrbitInPlaneAU(rc.elements, tJd);
      const ref = rc.refInPlaneAU!;
      const dxPc = (now.xAU - ref.xAU) * AU_PC;
      const dyPc = (now.yAU - ref.yAU) * AU_PC;
      const v = projectGalacticPlaneToICRS(dxPc, dyPc);
      DELTA_OUT.x = v.x;
      DELTA_OUT.y = v.y;
      DELTA_OUT.z = v.z;
    }
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
