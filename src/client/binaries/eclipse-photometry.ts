// Per-frame eclipse photometry field. See
// src/client/binaries/README.md § Eclipse photometry.

import * as THREE from 'three';
import {
  FLAG_HAS_ORBIT,
  type BinariesData,
} from './binaries-loader';
import { eclipseDim, type Vec3Ro } from './eclipse-photometry-pure';
import { R_SUN_PC } from '../util/astronomy-constants';
import { VISIBILITY_HORIZON_PC } from './binary-tuning';

export interface EclipsePhotometryFieldOptions {
  binaries: BinariesData;
  /** Per-instance local-frame star positions. Same buffer BinaryOrbitField
   *  writes to; this field READS it after the orbit pass has run, so the
   *  positions already carry per-frame orbital perturbation. */
  localPositions: Float32Array;
  /** Catalog-wide absolute magnitudes; drives the primary-visibility LOD. */
  absoluteMags: Float32Array;
  /** Per-star physical radius in solar radii. Promoted to parsecs by
   *  multiplying through `R_SUN_PC` at evaluation time. */
  physicalRadiusSolar: Float32Array;
  /** Per-instance multiplicative dim factor on the back component's flux.
   *  Length = catalog.count. Initialised to 1.0 at construction; the
   *  field rewrites the touched-this-frame slots and resets the
   *  touched-last-frame slots so transient occlusion events clear. */
  eclipseDimBuffer: Float32Array;
  /** Three.js attribute carrier flushed at the end of each update(). */
  iEclipseDimAttr: THREE.InstancedBufferAttribute;
}

interface RelationCache {
  relationIdx: number;
  primaryIdx: number;
  secondaryIdx: number;
}

export class EclipsePhotometryField {
  private opts: EclipsePhotometryFieldOptions;
  private relations: RelationCache[] = [];
  private touched: number[] = [];

  constructor(opts: EclipsePhotometryFieldOptions) {
    this.opts = opts;
    this.buildCache();
  }

  /** Read-only access to the cached relation list — exposed for tests
   *  that iterate the per-frame work set without re-parsing binaries.bin. */
  get cachedRelations(): readonly RelationCache[] {
    return this.relations;
  }

  /** Per-frame walk. The magnitude + horizon prefilters share their
   *  shape with BinaryOrbitField's so the two fields skip the same
   *  off-screen population each frame. */
  update(
    cameraPos: Readonly<THREE.Vector3>,
    maxAppMag: number,
  ): void {
    const local = this.opts.localPositions;
    const absMags = this.opts.absoluteMags;
    const radSolar = this.opts.physicalRadiusSolar;
    const dimBuf = this.opts.eclipseDimBuffer;

    // Reset slots written last frame so transient occlusions clear.
    // Only touched-then-not-touched-again slots survive — the dominant
    // case is "nothing was ever touched" or "the same pair touches the
    // same slot frame over frame", both O(1) churn.
    for (let i = 0; i < this.touched.length; i++) {
      dimBuf[this.touched[i]] = 1;
    }
    this.touched.length = 0;

    for (let i = 0; i < this.relations.length; i++) {
      const rc = this.relations[i];
      const pBase = rc.primaryIdx * 3;
      const sBase = rc.secondaryIdx * 3;

      const px = local[pBase];
      const py = local[pBase + 1];
      const pz = local[pBase + 2];
      const sx = local[sBase];
      const sy = local[sBase + 1];
      const sz = local[sBase + 2];

      // Primary-distance magnitude prefilter shares its shape with
      // BinaryOrbitField's (m_app > maxAppMag + 0.5 ⇒ off-screen). The
      // back component might be much fainter, but the back's brightness
      // alone isn't useful here — what we need is "is the COMPOSITE
      // visible," which the brighter primary's prefilter answers.
      const dx = px - cameraPos.x;
      const dy = py - cameraPos.y;
      const dz = pz - cameraPos.z;
      const dCamPc = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dCamPc > VISIBILITY_HORIZON_PC) continue;
      const appMag = absMags[rc.primaryIdx] + 5 * (Math.log10(Math.max(dCamPc, 1e-30)) - 1);
      if (appMag > maxAppMag + 0.5) continue;

      const rPriPc = radSolar[rc.primaryIdx] * R_SUN_PC;
      const rSecPc = radSolar[rc.secondaryIdx] * R_SUN_PC;
      const primary: Vec3Ro = { x: px, y: py, z: pz };
      const secondary: Vec3Ro = { x: sx, y: sy, z: sz };
      const cam: Vec3Ro = { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z };
      const result = eclipseDim({
        primary, secondary, camera: cam,
        radiusPrimaryPc: rPriPc, radiusSecondaryPc: rSecPc,
      });
      if (result.dim >= 1) continue;
      const backIdx = result.front === 'primary' ? rc.secondaryIdx : rc.primaryIdx;
      // Take min when the same star is the back of multiple
      // contemporaneous overlaps (hierarchical pair where the inner
      // secondary is occluded by both the inner primary AND the outer
      // primary in the same frame, say). Two independent occlusions
      // would multiply rather than min, but min is the safe lower
      // bound and the regime is rare enough not to warrant the
      // bookkeeping.
      if (result.dim < dimBuf[backIdx]) {
        dimBuf[backIdx] = result.dim;
        this.touched.push(backIdx);
      }
    }

    this.opts.iEclipseDimAttr.needsUpdate = true;
  }

  dispose(): void {
    // Buffer + attribute carrier are owned by the integration shell. The
    // class holds only the relation cache, which the GC reclaims when
    // the instance drops out of scope.
  }

  private buildCache(): void {
    const relations = this.opts.binaries.relations;
    for (let i = 0; i < relations.length; i++) {
      const r = relations[i];
      if ((r.flags & FLAG_HAS_ORBIT) === 0) continue;
      // binaries.bin invariant: has_orbit=1 implies finite Kepler
      // elements. The orbit field's buildCache also rejects records
      // that violate this; we mirror the skip here so a malformed
      // relation can't poison eclipseDim with a NaN write.
      if (
        !Number.isFinite(r.q) || !Number.isFinite(r.aAU)
        || !Number.isFinite(r.e) || !Number.isFinite(r.pDays)
        || !Number.isFinite(r.tJd) || !Number.isFinite(r.omegaRad)
      ) continue;
      this.relations.push({
        relationIdx: i,
        primaryIdx: r.primaryIdx,
        secondaryIdx: r.secondaryIdx,
      });
    }
  }
}
