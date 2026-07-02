// Per-frame eclipse photometry field. See
// src/client/binaries/README.md § Eclipse photometry.

import * as THREE from 'three';
import { type BinariesData } from './binaries-loader';
import {
  eclipseDimFromOffsets,
  orbitPlaneNormalICRS,
  type EclipseResult,
} from './eclipse-photometry-pure';
import {
  buildOrbitRelationCaches,
  evaluateOrbitRelationDeltaPc,
  type OrbitRelationCache,
} from './orbit-relation-cache';
import { R_SUN_PC } from '../util/astronomy-constants';
import { tToJDE } from '../solar-system/time';
import { VISIBILITY_HORIZON_PC, ECLIPSE_DIM_TAU_S } from './binary-tuning';
import { apparentMagnitude } from '../solar-system/perceptual-magnitude';

export interface EclipsePhotometryFieldOptions {
  binaries: BinariesData;
  /** Catalog-wide absolute ICRS positions. Source of each pair's baked
   *  baseline offset and the Tier-1 tangent-basis anchor. */
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
  /** Baked catalog offset secondary − primary, pc. Float64 difference of
   *  the float32 absolutes — small and exact; combined with ΔR(t) it
   *  reproduces the RENDERED pair offset in every walk regime (barycentric
   *  split, focal rebase, hierarchical anchor all preserve
   *  sCoeff − pCoeff = 1). */
  baseDiff: { x: number; y: number; z: number };
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

/** Samples per orbit when bounding the minimum rendered separation for
 *  the prefilter. */
const MIN_SEP_SAMPLES = 32;
/** Safety factor on the sampled minimum — the true minimum can fall
 *  between samples. */
const MIN_SEP_SAFETY = 0.5;
/** A slot whose dim has decayed above this snaps to exactly 1 and leaves
 *  the active set (the shader gate is `iEclipseDim < 1.0`). */
const DIM_SETTLED = 0.999;

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
    let blend = 1;
    if (this.lastNowMs !== null) {
      const dtS = Math.min(Math.max((nowMs - this.lastNowMs) / 1000, 0), 0.25);
      blend = 1 - Math.exp(-dtS / ECLIPSE_DIM_TAU_S);
    }
    this.lastNowMs = nowMs;

    const dimBuf = this.opts.eclipseDimBuffer;
    const targets = this.targets;
    targets.clear();

    for (let i = 0; i < this.relations.length; i++) {
      const rc = this.relations[i];
      const ev = this.evaluateRelation(rc, tJd, cameraPos, maxAppMag);
      const result = ev.result;
      if (result === null || result.dim >= 1) continue;
      const backIdx = result.front === 'primary' ? rc.secondaryIdx : rc.primaryIdx;
      // Take min when the same star is the back of multiple
      // contemporaneous overlaps (hierarchical pair where the inner
      // secondary is occluded by both the inner primary AND the outer
      // primary in the same frame, say). Two independent occlusions
      // would multiply rather than min, but min is the safe lower
      // bound and the regime is rare enough not to warrant the
      // bookkeeping.
      const prev = targets.get(backIdx);
      if (prev === undefined || result.dim < prev) targets.set(backIdx, result.dim);
    }

    let wrote = false;
    for (const [idx, target] of targets) {
      dimBuf[idx] += (target - dimBuf[idx]) * blend;
      this.active.add(idx);
      wrote = true;
    }
    for (const idx of this.active) {
      if (targets.has(idx)) continue;
      const next = dimBuf[idx] + (1 - dimBuf[idx]) * blend;
      if (next >= DIM_SETTLED) {
        dimBuf[idx] = 1;
        this.active.delete(idx);
      } else {
        dimBuf[idx] = next;
      }
      wrote = true;
    }
    if (wrote) this.opts.iEclipseDimAttr.needsUpdate = true;
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
    if (appMag > maxAppMag + 0.5) {
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
    const relX = rc.baseDiff.x + delta.x;
    const relY = rc.baseDiff.y + delta.y;
    const relZ = rc.baseDiff.z + delta.z;

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
      abs.length,
    );
    for (const orbit of orbitCaches) {
      const r = this.opts.binaries.relations[orbit.relationIdx];
      const pBase = r.primaryIdx * 3;
      const sBase = r.secondaryIdx * 3;
      const baseDiff = {
        x: abs[sBase] - abs[pBase],
        y: abs[sBase + 1] - abs[pBase + 1],
        z: abs[sBase + 2] - abs[pBase + 2],
      };
      const rPriPc = radSolar[r.primaryIdx] * R_SUN_PC;
      const rSecPc = radSolar[r.secondaryIdx] * R_SUN_PC;
      SYSTEM_XYZ.x = abs[pBase];
      SYSTEM_XYZ.y = abs[pBase + 1];
      SYSTEM_XYZ.z = abs[pBase + 2];
      const normal = orbitPlaneNormalICRS(orbit.tier, orbit.elements, SYSTEM_XYZ);

      // Minimum rendered pair separation over one orbit bounds the
      // prefilter: the widest LOS-vs-plane angle that can still eclipse
      // is (rPri + rSec) / minSep. Sampled (not closed-form) because the
      // rendered offset is baseDiff + ΔR(t), whose minimum can sit far
      // below the orbit's periapsis when the baked baseline doesn't
      // match R(baseline epoch).
      let minSepSq = Infinity;
      for (let k = 0; k < MIN_SEP_SAMPLES; k++) {
        const tJd = orbit.elements.T + (orbit.elements.P * k) / MIN_SEP_SAMPLES;
        const d = evaluateOrbitRelationDeltaPc(orbit, tJd, SYSTEM_XYZ);
        const x = baseDiff.x + d.x;
        const y = baseDiff.y + d.y;
        const z = baseDiff.z + d.z;
        const sq = x * x + y * y + z * z;
        if (sq < minSepSq) minSepSq = sq;
      }
      const minSepPc = Math.sqrt(minSepSq) * MIN_SEP_SAFETY;
      const discSumPc = rPriPc + rSecPc;
      const sinLimit = minSepPc > discSumPc
        ? Math.min(1, discSumPc / minSepPc)
        : 1;

      this.relations.push({
        orbit,
        primaryIdx: r.primaryIdx,
        secondaryIdx: r.secondaryIdx,
        baseDiff,
        rPriPc,
        rSecPc,
        normal,
        sinLimit,
      });
    }
  }
}
