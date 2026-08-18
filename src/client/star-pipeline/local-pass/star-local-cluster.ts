// The star LocalCluster: per-frame star membership + orbit-path
// ellipses for the local depth pass. See ../../local-depth/README.md
// § Full membership.

import * as THREE from 'three';
import type { BinariesData } from '../../binaries/binaries-loader';
import { keplerChainRelationIdxs } from '../../binaries/binary-orbit-path-pure';
import type { BinaryOrbitPathLayer } from '../../binaries/binary-orbit-path-layer';
import {
  peakAmplitudeFactor,
  type RenderedSizeComponents,
} from '../../camera/controls/star-physics';
import type { LocalCluster } from '../../local-depth/local-depth-pass';
import type { MemberSphere } from '../../local-depth/bracket/slice-pure';
import type { Catalog } from '../../loaders/catalog-loader';
import { MIN_PHYSICAL_RADIUS_R_SUN, R_SUN_PC } from '../../util/astronomy-constants';
import { MIRROR_CAPACITY, type StarLocalMirror } from './star-local-mirror';
import { isResolvedDiscStar } from './star-local-cluster-pure';

export interface StarLocalClusterDeps {
  catalog: Catalog;
  localPositions: () => Float32Array;
  /** CPU mirror of the shader's per-star size terms (star-physics
   *  `renderedSizeComponents`) — the shell owns the uniform / filter
   *  references it reads. Writes into `out`, no allocation. */
  renderedSizeComponents: (idx: number, out: RenderedSizeComponents) => RenderedSizeComponents;
  /** Walk stars within `dThreshPc` of the camera (the Sol-distance-
   *  sorted window). `cb` returns true to stop early. */
  forEachStarNearCamera: (dThreshPc: number, cb: (idx: number) => boolean) => void;
  /** Camera-distance bound past which no star can render a member-
   *  eligible disc — the scan window. */
  scanWindowPc: () => number;
}

export interface StarLocalClusterFrame {
  monochrome: boolean;
  focalIdx: number | null;
  thresholdMag: number;
}

/**
 * Owns star membership in the local depth pass. A member's main-pass
 * instance collapses (`uLocalMemberIdx`, all three passes) and the
 * mirror re-renders it in the bracketed pass, whose z-buffer orders
 * close-pair discs natively and whose repaint occludes main-pass glow
 * behind a resolved disc by construction. Members per frame:
 *
 * 1. The active planet-system host (full membership — set each frame by
 *    `SolarSystemCluster.update` via `setHostMember`).
 * 2. The focal star's Kepler chain, whenever its orbit paths draw or
 *    any chain member resolves as a disc.
 * 3. Any resolved-disc star near the camera (unfocused fly-bys — a
 *    giant's opaque disc otherwise writes standard depth 1.0 past the
 *    near-plane band and ties, rather than occludes, background glow).
 */
export class StarLocalCluster implements LocalCluster {
  readonly group: THREE.Group;

  private readonly mirror: StarLocalMirror;
  private readonly pathLayer: BinaryOrbitPathLayer;
  private readonly localMemberIdx: { value: Int32Array };
  private readonly deps: StarLocalClusterDeps;

  private hostMemberIdx: number | null = null;
  private binaries: BinariesData | null = null;
  private chainStarsCache: number[] = [];
  private chainFocalIdx: number | null = null;
  private chainBinaries: BinariesData | null = null;

  private readonly members: number[] = [];
  private readonly memberSet = new Set<number>();
  private readonly spheres: MemberSphere[] = [];
  private readonly sizeScratch: RenderedSizeComponents = {
    appMag: 0, appSizePx: 0, physSizePx: 0, physSizePxUncapped: 0,
  };

  constructor(
    mirror: StarLocalMirror,
    pathLayer: BinaryOrbitPathLayer,
    localMemberIdxUniform: { value: Int32Array },
    deps: StarLocalClusterDeps,
  ) {
    this.mirror = mirror;
    this.pathLayer = pathLayer;
    this.localMemberIdx = localMemberIdxUniform;
    this.deps = deps;
    this.group = new THREE.Group();
    this.group.name = 'star-local-cluster';
    this.group.add(mirror.group);
    this.group.add(pathLayer.group);
  }

  /** Host star of the active planet-system cluster, or null. Written
   *  each frame by `SolarSystemCluster.update` (which runs earlier in
   *  the layer registry); consumed by `update` below. */
  setHostMember(idx: number | null): void {
    this.hostMemberIdx = idx;
  }

  setBinaries(binaries: BinariesData | null): void {
    this.binaries = binaries;
    this.chainBinaries = null;
  }

  /** Runs in the scene-layer registry AFTER the binary orbit walk +
   *  eclipse photometry + path-layer update: membership reads this
   *  frame's positions and path visibility, and the mirror sync
   *  re-copies the per-instance slots those fields just wrote. */
  update(camera: THREE.PerspectiveCamera, frame: StarLocalClusterFrame): void {
    this.members.length = 0;
    this.memberSet.clear();
    this.spheres.length = 0;

    // Chart mode inks stars as flat main-pass discs with depth disabled;
    // suppression and mirrors must stay out of the way entirely.
    if (!frame.monochrome) {
      if (this.hostMemberIdx !== null) this.addMember(this.hostMemberIdx);

      const chain = this.chainStars(frame.focalIdx);
      if (chain.length > 0) {
        // Full membership per system: once the pass touches the pair
        // (paths drawing, or a member resolving as a disc), every chain
        // star mirrors, so a glow-sized companion transiting in front of
        // a resolved primary depth-tests against it instead of being
        // over-painted.
        let engage = this.pathLayer.anyOrbitRingVisible();
        for (let i = 0; !engage && i < chain.length; i++) {
          engage = this.isMemberEligible(chain[i], frame.thresholdMag);
        }
        if (engage) for (const idx of chain) this.addMember(idx);
      }

      this.deps.forEachStarNearCamera(this.deps.scanWindowPc(), (idx) => {
        if (!this.memberSet.has(idx) && this.isMemberEligible(idx, frame.thresholdMag)) {
          this.addMember(idx);
        }
        return this.members.length >= MIRROR_CAPACITY;
      });
    }

    const u = this.localMemberIdx.value;
    u.fill(-1);
    for (let m = 0; m < this.members.length; m++) u[m] = this.members[m];
    this.mirror.setMembers(this.members);
    this.mirror.sync();

    const local = this.deps.localPositions();
    const { physicalRadius } = this.deps.catalog;
    for (const idx of this.members) {
      const dx = local[idx * 3] - camera.position.x;
      const dy = local[idx * 3 + 1] - camera.position.y;
      const dz = local[idx * 3 + 2] - camera.position.z;
      const R = Math.max(physicalRadius[idx], MIN_PHYSICAL_RADIUS_R_SUN) * R_SUN_PC;
      this.spheres.push({
        distPc: Math.sqrt(dx * dx + dy * dy + dz * dz),
        radiusPc: R * peakAmplitudeFactor(this.deps.catalog, idx),
      });
    }
    this.pathLayer.collectSpheres(camera, this.spheres);
  }

  /** Replays the spheres `update()` computed this frame — the scene-
   *  layer registry runs `update()` before `localDepthPass.render`, so
   *  the list is current. Not self-sufficient: never call standalone. */
  collectSpheres(_camera: THREE.PerspectiveCamera, out: MemberSphere[]): void {
    for (const s of this.spheres) out.push(s);
  }

  /** True when this frame's `update()` produced members. The shell ORs
   *  this into the core-mask mesh gate: a member's mask stamp must
   *  render even when the pure-physSize window misses an
   *  appSize-driven member disc. */
  hasMembers(): boolean {
    return this.members.length > 0;
  }

  dispose(): void {
    this.mirror.dispose();
  }

  private addMember(idx: number): void {
    if (this.members.length >= MIRROR_CAPACITY || this.memberSet.has(idx)) return;
    this.members.push(idx);
    this.memberSet.add(idx);
  }

  private isMemberEligible(idx: number, thresholdMag: number): boolean {
    const c = this.deps.renderedSizeComponents(idx, this.sizeScratch);
    // The disc pass hard-discards past the magnitude limit, so a
    // slider-hidden star has no disc to mirror.
    return c.appMag <= thresholdMag
      && isResolvedDiscStar(c.appSizePx, c.physSizePx);
  }

  private chainStars(focalIdx: number | null): number[] {
    if (focalIdx !== this.chainFocalIdx || this.binaries !== this.chainBinaries) {
      this.chainFocalIdx = focalIdx;
      this.chainBinaries = this.binaries;
      this.chainStarsCache.length = 0;
      if (this.binaries !== null) {
        const seen = new Set<number>();
        for (const ri of keplerChainRelationIdxs(this.binaries, focalIdx)) {
          const r = this.binaries.relations[ri];
          for (const idx of [r.primaryIdx, r.secondaryIdx]) {
            if (!seen.has(idx)) { seen.add(idx); this.chainStarsCache.push(idx); }
          }
        }
      }
    }
    return this.chainStarsCache;
  }
}
