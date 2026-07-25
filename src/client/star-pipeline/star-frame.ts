// The CPU-side star position frame: floating origin, epoch advance, the
// derived per-instance buffers, and the Sol-distance-sorted proximity
// queries. See star-pipeline/README.md § The star frame.

import * as THREE from 'three';
import { sortedDistRange } from '../camera/controls/star-geometry';
import type { Catalog } from '../loaders/catalog-loader';
import {
  advancePositionsToEpoch,
  bucketEpochJyr,
  jdeToJulianEpochYear,
  maxSpeedPcPerYr,
} from '../loaders/epoch-advance-pure';
import { T_CLAMP_MAX_S, T_CLAMP_MIN_S, tToJDE } from '../solar-system/time/time';
import { MIN_PHYSICAL_RADIUS_R_SUN, R_SUN_PC } from '../util/astronomy-constants';
import { bestApsisTeff } from './star-color-routing-pure';
import { discWindowPc, RESOLVED_DISC_MIN_PX } from './star-local-cluster-pure';
import type { StarSharedUniforms } from './star-shared-uniforms';

export interface StarFrameOptions {
  catalog: Catalog;
  uniforms: StarSharedUniforms;
  /** Live reference to `camera.position` — the camera in the same local
   *  frame as `localPositions`. Read by the proximity queries. */
  cameraPosition: THREE.Vector3;
  /** Model-clock `t` the catalog positions are first advanced to. */
  t: number;
  /** Fired after every local-position rewrite: flags the GPU
   *  re-upload and re-derives any baseline captured in the old frame. */
  onLocalPositionsWritten: () => void;
}

/**
 * Owns `catalog.positions` in the renderer's frame:
 *
 *  - the floating origin (`worldOffset`) and the `localPositions`
 *    buffer bound to the `iPosition` attribute,
 *  - space-motion epoch advance off the immutable J2016.0 baseline,
 *  - the per-instance buffers derived once at load (log radius,
 *    luminosity class, Sol distance, Apsis Teff),
 *  - the Sol-distance-sorted index and the proximity queries built on
 *    it (near-camera walk, core-mask gate).
 *
 * Local-position rewrites coalesce: `advanceEpochTo` only marks the
 * buffer stale, and `flushLocalPositions` does the single rewrite, so
 * a frame where an epoch re-advance and an origin recentre both fire
 * pays one pass over the catalog instead of two.
 */
export class StarFrame {
  /** Per-star log10(physicalRadius_solar) for the `iLogRadius` attribute. */
  readonly logRadii: Float32Array;
  /** Per-star luminosity class as Float32 (255 = unknown, handled in
   *  the shader). */
  readonly lumClassF32: Float32Array;
  /** Per-star distance from Sol in pc — the `iDistSol` attribute, and
   *  the key the proximity index sorts on. */
  readonly distSol: Float32Array;
  /** Per-star best Apsis Teff (K); 0 = no Apsis solution. */
  readonly teffApsis: Float32Array;
  /** Largest physicalRadius in the catalog, in pc. The core-mask and
   *  member-scan windows solve for the distance at which this worst-case
   *  disc crosses their pixel threshold. */
  readonly maxPhysicalRadiusPc: number;

  /** `catalog.positions − worldOffset`, bound to the dynamic
   *  `iPosition` attribute. Rewritten in place. */
  readonly localPositions: Float32Array;
  /** Absolute-space coordinate sitting at local (0,0,0). Read-only to
   *  callers — `recenterTo` is the only writer. */
  readonly worldOffset = new THREE.Vector3();

  /** Catalog indices ordered by ascending distance from Sol, with that
   *  distance in the parallel array. Sol distance is intrinsic (absolute
   *  catalog positions) and therefore stable across floating-origin
   *  recenters, so the index is built once. `sortedDistRange` slices it
   *  for the near-camera walk here and for the Picker's distSol-filter
   *  window. */
  readonly sortedByDistFromSol: Uint32Array;
  readonly sortedDistFromSol: Float32Array;

  /** Pristine J2016.0 catalog positions — the immutable baseline every
   *  epoch (re-)advance writes catalog.positions from. Never mutate;
   *  `BinaryOrbitField` re-advances its own slots off it. */
  readonly basePositions: Float32Array;

  private readonly catalog: Catalog;
  private readonly uniforms: StarSharedUniforms;
  private readonly cameraPosition: THREE.Vector3;
  private readonly onLocalPositionsWritten: () => void;

  private _advancedEpochJyr: number;
  private readonly maxEpochDriftPc: number;
  private localPositionsStale = false;

  private readonly recenterDelta = new THREE.Vector3();

  constructor(opts: StarFrameOptions) {
    const { catalog, uniforms, cameraPosition, t, onLocalPositionsWritten } = opts;
    this.catalog = catalog;
    this.uniforms = uniforms;
    this.cameraPosition = cameraPosition;
    this.onLocalPositionsWritten = onLocalPositionsWritten;

    // Space-motion propagation: advance catalog.positions off the pristine
    // J2016.0 baseline (snapshotted here, kept immutable) to the model clock
    // before any consumer reads a position. localPositions, iDistSol,
    // hover/focus/warp targets, constellation lines, binaries baselines, and
    // eclipse photometry all inherit current-epoch positions by construction.
    // See docs/science-catalog-ingestion.md § Current-epoch star positions.
    this.basePositions = new Float32Array(catalog.positions);
    this._advancedEpochJyr = bucketEpochJyr(jdeToJulianEpochYear(tToJDE(t)));
    advancePositionsToEpoch(
      this.basePositions,
      catalog.velocities,
      this._advancedEpochJyr,
      catalog.positions,
    );
    // How far any star can sit from its load-epoch position over the full
    // clamped scrub range — the widening the load-time sortedDistFromSol
    // windows need to stay correct at any scrubbed t.
    this.maxEpochDriftPc = maxSpeedPcPerYr(catalog.velocities) * Math.max(
      this._advancedEpochJyr - jdeToJulianEpochYear(tToJDE(T_CLAMP_MIN_S)),
      jdeToJulianEpochYear(tToJDE(T_CLAMP_MAX_S)) - this._advancedEpochJyr,
    );

    this.logRadii = new Float32Array(catalog.count);
    this.lumClassF32 = new Float32Array(catalog.count);
    this.distSol = new Float32Array(catalog.count);
    this.teffApsis = new Float32Array(catalog.count);
    let maxPhysicalRadius = 0;
    for (let i = 0; i < catalog.count; i++) {
      const r = Math.max(catalog.physicalRadius[i], MIN_PHYSICAL_RADIUS_R_SUN);
      this.logRadii[i] = Math.log10(r);
      if (r > maxPhysicalRadius) maxPhysicalRadius = r;
      this.lumClassF32[i] = catalog.luminosityClass[i];
      const x = catalog.positions[i * 3];
      const y = catalog.positions[i * 3 + 1];
      const z = catalog.positions[i * 3 + 2];
      this.distSol[i] = Math.sqrt(x * x + y * y + z * z);
      this.teffApsis[i] = bestApsisTeff(catalog.teffGspphot[i], catalog.teffGspspec[i]);
    }
    this.maxPhysicalRadiusPc = maxPhysicalRadius * R_SUN_PC;

    // Starts identical to catalog.positions since worldOffset is (0,0,0).
    this.localPositions = new Float32Array(catalog.positions);

    this.sortedByDistFromSol = new Uint32Array(catalog.count);
    for (let i = 0; i < catalog.count; i++) this.sortedByDistFromSol[i] = i;
    this.sortedByDistFromSol.sort((a, b) => this.distSol[a] - this.distSol[b]);
    this.sortedDistFromSol = new Float32Array(catalog.count);
    for (let i = 0; i < catalog.count; i++) {
      this.sortedDistFromSol[i] = this.distSol[this.sortedByDistFromSol[i]];
    }
  }

  /** Bucketised Julian epoch year the catalog positions currently sit
   *  at. Changes exactly when a re-advance rewrote the positions. */
  get advancedEpochJyr(): number { return this._advancedEpochJyr; }

  /** Local-frame position of star `i` written into `out`. */
  localPositionInto(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.localPositions;
    return out.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }

  /**
   * Shift the local origin to `newOrigin` (absolute space), rewriting
   * the instance-position buffer as `absolute − newOrigin` in JS Number
   * precision (= float64) before the float32 write-back, so local
   * coordinates near the new origin retain full float32 resolution.
   *
   * Returns the applied (dx, dy, dz) so the caller can migrate camera,
   * orbit target, and any auxiliary state captured in the old frame;
   * null when `newOrigin` already is the origin. The returned Vector3
   * is shared scratch — copy it to outlive the next call.
   */
  recenterTo(newOrigin: THREE.Vector3): THREE.Vector3 | null {
    const dx = newOrigin.x - this.worldOffset.x;
    const dy = newOrigin.y - this.worldOffset.y;
    const dz = newOrigin.z - this.worldOffset.z;
    if (dx === 0 && dy === 0 && dz === 0) return null;
    this.writeLocalPositions(newOrigin.x, newOrigin.y, newOrigin.z);
    this.worldOffset.copy(newOrigin);
    // The shader reconstructs absolute positions for dust sampling as
    // local-frame iPosition + uWorldOffset.
    this.uniforms.uWorldOffset.value.copy(newOrigin);
    return this.recenterDelta.set(dx, dy, dz);
  }

  /**
   * Re-run the epoch-advance pass off the immutable baseline when the
   * model clock crosses a bucket. Returns false (nothing written) when
   * the positions already sit at `t`'s bucket.
   *
   * `focalIdx`'s space-motion delta lands in `outDelta` so the caller
   * can translate the camera by it and keep the focal star under the
   * pin; zero when nothing is focused. The local-position buffer is
   * left stale for `flushLocalPositions`.
   */
  advanceEpochTo(
    t: number,
    focalIdx: number | null,
    outDelta: THREE.Vector3,
  ): boolean {
    const targetJyr = bucketEpochJyr(jdeToJulianEpochYear(tToJDE(t)));
    if (targetJyr === this._advancedEpochJyr) return false;
    const abs = this.catalog.positions;
    const fx = focalIdx === null ? 0 : abs[focalIdx * 3];
    const fy = focalIdx === null ? 0 : abs[focalIdx * 3 + 1];
    const fz = focalIdx === null ? 0 : abs[focalIdx * 3 + 2];
    advancePositionsToEpoch(
      this.basePositions,
      this.catalog.velocities,
      targetJyr,
      abs,
    );
    this._advancedEpochJyr = targetJyr;
    this.localPositionsStale = true;
    outDelta.set(
      focalIdx === null ? 0 : abs[focalIdx * 3] - fx,
      focalIdx === null ? 0 : abs[focalIdx * 3 + 1] - fy,
      focalIdx === null ? 0 : abs[focalIdx * 3 + 2] - fz,
    );
    return true;
  }

  /** Rewrite the local buffer if an epoch advance left it stale and no
   *  recentre has since rewritten it at the current origin. Callers
   *  must run this before anything reads `localPositions` again — the
   *  only window where the buffer trails `catalog.positions` is
   *  between `advanceEpochTo` and this call. */
  flushLocalPositions(): void {
    if (!this.localPositionsStale) return;
    this.writeLocalPositions(this.worldOffset.x, this.worldOffset.y, this.worldOffset.z);
  }

  private writeLocalPositions(ox: number, oy: number, oz: number): void {
    const abs = this.catalog.positions;
    const loc = this.localPositions;
    const n = this.catalog.count;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      loc[j] = abs[j] - ox;
      loc[j + 1] = abs[j + 1] - oy;
      loc[j + 2] = abs[j + 2] - oz;
    }
    this.localPositionsStale = false;
    this.onLocalPositionsWritten();
  }

  /** Camera-distance bound at which the catalog's largest star subtends
   *  `px` pixels under the live FOV / viewport uniforms, so changing
   *  exaggeration K, FOV, or viewport keeps the dependent gates honest. */
  discWindowPcFor(px: number): number {
    return discWindowPc(
      this.maxPhysicalRadiusPc,
      px,
      this.uniforms.uFovYRad.value,
      this.uniforms.uViewport.value.y,
    );
  }

  /**
   * Walk stars within `dThreshPc` of the camera. Uses the sorted-by-
   * distance-from-Sol index plus the triangle inequality: any star
   * within `dThreshPc` of the camera must have |distFromSol(star) −
   * distFromSol(camera)| ≤ dThreshPc. That window is binary-searched
   * (typically tens to hundreds of candidates) and only those get the
   * squared-distance check. `cb` returns true to stop the walk early.
   */
  forEachStarNearCamera(dThreshPc: number, cb: (idx: number) => boolean): void {
    const dThreshSq = dThreshPc * dThreshPc;

    const cx = this.cameraPosition.x;
    const cy = this.cameraPosition.y;
    const cz = this.cameraPosition.z;
    // Camera distance from Sol in absolute space (catalog frame).
    const camAbsX = cx + this.worldOffset.x;
    const camAbsY = cy + this.worldOffset.y;
    const camAbsZ = cz + this.worldOffset.z;
    const camDistFromSol = Math.sqrt(
      camAbsX * camAbsX + camAbsY * camAbsY + camAbsZ * camAbsZ,
    );
    // sortedDistFromSol holds load-epoch Sol distances; a scrubbed star can
    // sit up to maxEpochDriftPc away from its sorted value, so the window
    // widens by that bound. The in-window test below reads live positions.
    const lo = camDistFromSol - dThreshPc - this.maxEpochDriftPc;
    const hi = camDistFromSol + dThreshPc + this.maxEpochDriftPc;

    const sortedIdx = this.sortedByDistFromSol;
    const { start, end } = sortedDistRange(this.sortedDistFromSol, lo, hi);

    const positions = this.localPositions;
    for (let k = start; k < end; k++) {
      const i = sortedIdx[k];
      const dx = positions[i * 3] - cx;
      const dy = positions[i * 3 + 1] - cy;
      const dz = positions[i * 3 + 2] - cz;
      if (dx * dx + dy * dy + dz * dz < dThreshSq && cb(i)) return;
    }
  }

  /** Should the core depth-mask render this frame? True iff at least one
   *  star is close enough that its disc could reach RESOLVED_DISC_MIN_PX —
   *  below that, bleed-through is too small to see. */
  shouldEnableCoreMask(): boolean {
    let found = false;
    this.forEachStarNearCamera(
      this.discWindowPcFor(RESOLVED_DISC_MIN_PX),
      () => { found = true; return true; },
    );
    return found;
  }
}
