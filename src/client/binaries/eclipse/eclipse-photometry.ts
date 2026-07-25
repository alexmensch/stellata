// Per-frame eclipse photometry field. See
// ./README.md.

import * as THREE from 'three';
import { type BinariesData } from '../binaries-loader';
import {
  blendDimBuffer,
  dimBlendFactor,
  eclipseDimFromOffsets,
  orbitPlaneNormalICRS,
  type EclipseResult,
} from './eclipse-photometry-pure';
import {
  buildOrbitRelationCaches,
  evaluateOrbitRelationDeltaPc,
  type OrbitRelationCache,
} from '../orbit-relation-cache';
import { AU_PC, R_SUN_PC } from '../../util/astronomy-constants';
import { tToJDE } from '../../solar-system/time/time';
import {
  VISIBILITY_HORIZON_PC,
  ECLIPSE_DIM_TAU_S,
} from '../binary-tuning';
import { apparentMagnitude, SOFT_TAPER_MARGIN_MAG } from '../../solar-system/perceptual-magnitude';

export interface EclipsePhotometryFieldOptions {
  binaries: BinariesData;
  /** Catalog-wide absolute ICRS positions. Read for the Tier-1
   *  tangent-basis anchor (primary slot) only; the pair-relative offset
   *  rides on `OrbitRelationCache.baseDiffPc` + ΔR(t), never a float32
   *  slot subtraction. */
  absolutePositions: Float32Array;
  /** Per-instance local-frame star positions, read for the camera→
   *  primary line of sight only. The pair-RELATIVE geometry never
   *  touches this buffer — its float32 quantum exceeds typical pair
   *  separations whenever the local origin is far from the system. */
  localPositions: Float32Array;
  /** Catalog-wide absolute magnitudes; drives the primary-visibility LOD. */
  absoluteMags: Float32Array;
  /** Per-star physical radius in solar radii. Promoted to parsecs by
   *  multiplying through `R_SUN_PC` at cache build. */
  physicalRadiusSolar: Float32Array;
  /** Per-instance multiplicative dim factor on the back component's flux.
   *  Length = catalog.count. Initialised to 1.0 by the integration shell
   *  at allocation and on every re-attach. */
  eclipseDimBuffer: Float32Array;
  /** Three.js attribute carrier, flushed only on frames that write. */
  iEclipseDimAttr: THREE.InstancedBufferAttribute;
}

interface EclipseRelationCache {
  orbit: OrbitRelationCache;
  primaryIdx: number;
  secondaryIdx: number;
  rPriPc: number;
  rSecPc: number;
  /** Orbit-plane unit normal (ICRS), or null when degenerate. */
  normal: { x: number; y: number; z: number } | null;
  /** View-direction prefilter: eclipses are impossible unless
   *  |dot(camera→primary unit, normal)| ≤ sinLimit. Derived from the
   *  disc radii against the pair's minimum rendered separation; 1 means
   *  "never skip". */
  sinLimit: number;
}

/** One relation's walk verdict for a single frame. `gate` names the
 *  prefilter that stopped it, or 'clear' when the geometry ran. */
export interface EclipseRelationDebugRow {
  primaryIdx: number;
  secondaryIdx: number;
  tier: 1 | 2;
  gate: 'horizon' | 'mag' | 'plane' | 'clear';
  dCamPc: number;
  /** |dot(camera→primary unit, orbit normal)| — compared to sinLimit. */
  planeDot: number | null;
  sinLimit: number;
  /** Rendered pair separation, pc. NaN when gated before evaluation. */
  relPc: number;
  discSumPc: number;
  result: EclipseResult | null;
  bufPrimary: number;
  bufSecondary: number;
}

interface RelationEval {
  gate: 'horizon' | 'mag' | 'plane' | 'clear';
  dCamPc: number;
  planeDot: number | null;
  relX: number;
  relY: number;
  relZ: number;
  result: EclipseResult | null;
}

const SYSTEM_XYZ = { x: 0, y: 0, z: 0 };

export class EclipsePhotometryField {
  private opts: EclipsePhotometryFieldOptions;
  private relations: EclipseRelationCache[] = [];
  /** Slots currently holding dim < 1, decaying back toward 1 when no
   *  longer occluded. */
  private active = new Set<number>();
  /** Per-frame dim targets, keyed by back-star instance index. Reused
   *  across frames to avoid per-frame allocation. */
  private targets = new Map<number, number>();
  private lastNowMs: number | null = null;

  constructor(opts: EclipsePhotometryFieldOptions) {
    this.opts = opts;
    this.buildCache();
  }

  /** Read-only access to the cached relation list — exposed for tests
   *  that iterate the per-frame work set without re-parsing binaries.bin. */
  get cachedRelations(): readonly EclipseRelationCache[] {
    return this.relations;
  }

  /** Per-frame walk. `t` is the sim time (same value the orbit field
   *  receives); `nowMs` is the real-time frame stamp driving the
   *  anti-strobe smoothing. The magnitude + horizon prefilters share
   *  their shape with BinaryOrbitField's so the two fields skip the
   *  same off-screen population; the Kepler eval here is deliberately
   *  NOT gated on the orbit field's screen-pixel LOD — the photometric
   *  dip is exactly the signal that remains when the pair is sub-pixel. */
  update(
    t: number,
    cameraPos: Readonly<THREE.Vector3>,
    maxAppMag: number,
    nowMs: number,
  ): void {
    const tJd = tToJDE(t);
    const blend = dimBlendFactor(nowMs, this.lastNowMs, ECLIPSE_DIM_TAU_S);
    this.lastNowMs = nowMs;

    const dimBuf = this.opts.eclipseDimBuffer;
    const targets = this.targets;
    targets.clear();

    for (let i = 0; i < this.relations.length; i++) {
      const rc = this.relations[i];
      const ev = this.evaluateRelation(rc, tJd, cameraPos, maxAppMag);
      const result = ev.result;
      if (result === null) continue;
      const backIdx = result.front === 'primary' ? rc.secondaryIdx : rc.primaryIdx;

      // Photometric dim (glow pass) — keyed on real physical-radius
      // occlusion; only the back component's flux drops. Take min when a
      // star is the back of multiple contemporaneous overlaps (a
      // hierarchical inner secondary occluded by both the inner AND the
      // outer primary in one frame). Two independent occlusions would
      // multiply rather than min, but min is the safe lower bound and the
      // regime is rare enough not to warrant the bookkeeping.
      if (result.dim < 1) {
        const prev = targets.get(backIdx);
        if (prev === undefined || result.dim < prev) targets.set(backIdx, result.dim);
      }
    }

    if (blendDimBuffer(dimBuf, targets, this.active, blend)) {
      this.opts.iEclipseDimAttr.needsUpdate = true;
    }
  }

  /** Count of slots currently held below 1.0 (occluding or decaying). */
  get activeDimCount(): number {
    return this.active.size;
  }

  /** Read-only re-walk for the debug HUD. `starIdx` filters to relations
   *  containing that instance; null returns every relation that cleared
   *  the gates or currently holds a dim. Runs the same gates + geometry
   *  as update() but writes nothing. */
  debugRows(
    t: number,
    cameraPos: Readonly<THREE.Vector3>,
    maxAppMag: number,
    starIdx: number | null,
  ): EclipseRelationDebugRow[] {
    const tJd = tToJDE(t);
    const dimBuf = this.opts.eclipseDimBuffer;
    const rows: EclipseRelationDebugRow[] = [];
    for (const rc of this.relations) {
      if (starIdx !== null
        && rc.primaryIdx !== starIdx && rc.secondaryIdx !== starIdx) continue;
      const ev = this.evaluateRelation(rc, tJd, cameraPos, maxAppMag);
      const holdsDim = dimBuf[rc.primaryIdx] < 1 || dimBuf[rc.secondaryIdx] < 1;
      if (starIdx === null && ev.gate !== 'clear' && !holdsDim) continue;
      rows.push({
        primaryIdx: rc.primaryIdx,
        secondaryIdx: rc.secondaryIdx,
        tier: rc.orbit.tier,
        gate: ev.gate,
        dCamPc: ev.dCamPc,
        planeDot: ev.planeDot,
        sinLimit: rc.sinLimit,
        relPc: ev.result !== null
          ? Math.hypot(ev.relX, ev.relY, ev.relZ)
          : NaN,
        discSumPc: rc.rPriPc + rc.rSecPc,
        result: ev.result,
        bufPrimary: dimBuf[rc.primaryIdx],
        bufSecondary: dimBuf[rc.secondaryIdx],
      });
    }
    return rows;
  }

  dispose(): void {
    // Buffer + attribute carrier are owned by the integration shell. The
    // class holds only the relation cache, which the GC reclaims when
    // the instance drops out of scope.
  }

  private evaluateRelation(
    rc: EclipseRelationCache,
    tJd: number,
    cameraPos: Readonly<THREE.Vector3>,
    maxAppMag: number,
  ): RelationEval {
    const local = this.opts.localPositions;
    const abs = this.opts.absolutePositions;
    const pBase = rc.primaryIdx * 3;

    const losX = local[pBase] - cameraPos.x;
    const losY = local[pBase + 1] - cameraPos.y;
    const losZ = local[pBase + 2] - cameraPos.z;
    const dCamPc = Math.sqrt(losX * losX + losY * losY + losZ * losZ);
    if (dCamPc <= 0 || dCamPc > VISIBILITY_HORIZON_PC) {
      return { gate: 'horizon', dCamPc, planeDot: null, relX: 0, relY: 0, relZ: 0, result: null };
    }
    const appMag = apparentMagnitude(this.opts.absoluteMags[rc.primaryIdx], dCamPc);
    if (appMag > maxAppMag + SOFT_TAPER_MARGIN_MAG) {
      return { gate: 'mag', dCamPc, planeDot: null, relX: 0, relY: 0, relZ: 0, result: null };
    }

    // View-direction prefilter: the rendered pair offset always lies
    // (near-)in the orbit plane, so a line of sight steeper against
    // that plane than the discs' angular extent can never eclipse.
    // Skips the Kepler eval for the vast majority of (camera, pair)
    // combinations each frame.
    let planeDot: number | null = null;
    if (rc.normal !== null) {
      planeDot = Math.abs(
        (losX * rc.normal.x + losY * rc.normal.y + losZ * rc.normal.z) / dCamPc,
      );
      if (rc.sinLimit < 1 && planeDot > rc.sinLimit) {
        return { gate: 'plane', dCamPc, planeDot, relX: 0, relY: 0, relZ: 0, result: null };
      }
    }

    SYSTEM_XYZ.x = abs[pBase];
    SYSTEM_XYZ.y = abs[pBase + 1];
    SYSTEM_XYZ.z = abs[pBase + 2];
    const delta = evaluateOrbitRelationDeltaPc(rc.orbit, tJd, SYSTEM_XYZ);
    const relX = rc.orbit.baseDiffPc.x + delta.x;
    const relY = rc.orbit.baseDiffPc.y + delta.y;
    const relZ = rc.orbit.baseDiffPc.z + delta.z;

    const result = eclipseDimFromOffsets(
      losX, losY, losZ,
      relX, relY, relZ,
      rc.rPriPc, rc.rSecPc,
    );
    return { gate: 'clear', dCamPc, planeDot, relX, relY, relZ, result };
  }

  private buildCache(): void {
    const abs = this.opts.absolutePositions;
    const radSolar = this.opts.physicalRadiusSolar;
    const orbitCaches = buildOrbitRelationCaches(
      this.opts.binaries,
      abs,
    );
    for (const orbit of orbitCaches) {
      const r = this.opts.binaries.relations[orbit.relationIdx];
      const pBase = r.primaryIdx * 3;
      const rPriPc = radSolar[r.primaryIdx] * R_SUN_PC;
      const rSecPc = radSolar[r.secondaryIdx] * R_SUN_PC;
      SYSTEM_XYZ.x = abs[pBase];
      SYSTEM_XYZ.y = abs[pBase + 1];
      SYSTEM_XYZ.z = abs[pBase + 2];
      const normal = orbitPlaneNormalICRS(orbit.tier, orbit.elements, SYSTEM_XYZ);

      // Minimum pair separation over one orbit bounds the prefilter: the
      // widest LOS-vs-plane angle that can still occlude is
      // discSum / minSep. The rendered offset is baseDiffPc + ΔR(t) = R(t)
      // exactly, so its minimum is closed-form periapsis a(1−e) — no
      // sampling.
      const minSepPc = orbit.elements.a * (1 - orbit.elements.e) * AU_PC;
      const discSumPc = rPriPc + rSecPc;
      const sinLimit = minSepPc > discSumPc
        ? Math.min(1, discSumPc / minSepPc)
        : 1;

      this.relations.push({
        orbit,
        primaryIdx: r.primaryIdx,
        secondaryIdx: r.secondaryIdx,
        rPriPc,
        rSecPc,
        normal,
        sinLimit,
      });
    }
  }
}
