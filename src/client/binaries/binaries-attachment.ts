// See README.md#the-attachment.

import type * as THREE from 'three';
import type { ChromeLineMaterials } from '../chrome-lines/chrome-line-materials';
import type { SharedUniforms } from '../frame/shared-uniforms';
import type { Catalog } from '../loaders/catalog-loader';
import {
  CADENCE_REPORT_STILL,
  maxCadenceReport,
  type CadenceReport,
} from '../render-gate/cadence/clock-cadence-pure';
import type { CadenceCtx, SceneLayer } from '../scene/scene-layer';
import type { StarSourceAttributes } from '../star-pipeline/star-source-attributes';
import { uploadFull } from '../util/attribute-upload';
import { LateCell, mapLate, type Late } from '../util/late/late';
import type { BinariesData } from './binaries-loader';
import { BinaryOrbitField } from './binary-orbit-field';
import {
  EclipsePhotometryField,
  type EclipseRelationDebugRow,
} from './eclipse/eclipse-photometry';
import { BinaryOrbitPathLayer } from './orbit-paths/binary-orbit-path-layer';

export type FocalPerturbationSource = Pick<BinaryOrbitField, 'focalPerturbationInto'>;

export type BinaryStarAttributes =
  Pick<StarSourceAttributes, 'iPositionAttr' | 'iCompositeSuppressAttr' | 'iEclipseDimAttr'>;

export interface BinariesAttachmentDeps {
  catalog: Pick<Catalog, 'count' | 'positions' | 'velocities' | 'absmag' | 'physicalRadius'>;
  basePositions: Float32Array;
  localPositions: Float32Array;
  /** Built over `sourceArrays()`, so it can only be read after construction. */
  attributes: () => BinaryStarAttributes;
  uniforms: Pick<SharedUniforms, 'uViewport' | 'uFovYRad'>;
  chromeLines: ChromeLineMaterials;
  camera: THREE.PerspectiveCamera;
  worldOffset: Readonly<THREE.Vector3>;
  getT: () => number;
  thresholdMag: () => number;
  focusedStar: () => number | null;
  observeAnchorStar: () => number | null;
  onFocus: (handler: () => void) => () => void;
  /** Runs after the orbit walk and before eclipse photometry, whose line of
   *  sight reads the camera this moves. */
  rideFocal: (source: FocalPerturbationSource) => void;
}

interface Attached {
  readonly data: BinariesData;
  readonly orbits: BinaryOrbitField;
  readonly eclipse: EclipsePhotometryField;
}

export class BinariesAttachment {
  readonly orbitPaths: BinaryOrbitPathLayer;
  readonly entry: SceneLayer;
  readonly rate: (cc: CadenceCtx) => CadenceReport;

  private readonly attached = new LateCell<Attached>();
  readonly data: Late<BinariesData> = mapLate(this.attached, (a) => a.data);
  readonly focalPerturbation: Late<FocalPerturbationSource> =
    mapLate(this.attached, (a) => a.orbits);

  private readonly compositeSuppress: Float32Array;
  private readonly eclipseDim: Float32Array;
  private readonly unsubscribe: (() => void)[];

  constructor(private readonly deps: BinariesAttachmentDeps) {
    this.compositeSuppress = new Float32Array(deps.catalog.count);
    this.eclipseDim = new Float32Array(deps.catalog.count).fill(1);
    this.orbitPaths = new BinaryOrbitPathLayer(deps.chromeLines);
    this.rate = (cc) => this.whenAttached(
      (a) => maxCadenceReport(a.orbits.cadenceReport(cc), a.eclipse.cadenceReport(cc.simDtS)),
      CADENCE_REPORT_STILL,
    );
    const refreshOrbitPaths = () => this.orbitPaths.setSystem(
      this.whenAttached((a) => a.data, null),
      deps.focusedStar(),
      deps.catalog.positions,
    );
    this.unsubscribe = [deps.onFocus(refreshOrbitPaths), this.data.observe(refreshOrbitPaths)];
    this.entry = {
      timeBehaviour: { kind: 'clock', rate: this.rate },
      contribution: { kind: 'always' },
      update: (ctx) => {
        this.whenAttached((a) => this.walk(a), undefined);
        // After the walk wrote this frame's slots, so each path rides its
        // pair's live barycentre drift.
        this.orbitPaths.update(
          this.whenAttached((a) => a.orbits, null),
          deps.localPositions,
          ctx.camera,
          window.innerHeight,
          deps.observeAnchorStar(),
        );
      },
      recenter: (origin) => this.whenAttached((a) => a.orbits.recenter(origin), undefined),
      dispose: () => this.dispose(),
    };
  }

  /** The two per-star buffers the walk and the photometry write, for the
   *  star pipeline to wrap as attributes. */
  sourceArrays(): { compositeSuppress: Float32Array; eclipseDim: Float32Array } {
    return { compositeSuppress: this.compositeSuppress, eclipseDim: this.eclipseDim };
  }

  /** Null concludes the slot absent; a second table replaces the first. */
  attach(binaries: BinariesData | null): void {
    this.disposeFields();
    if (binaries === null) {
      this.attached.conclude();
      return;
    }
    const { catalog, localPositions } = this.deps;
    const attrs = this.deps.attributes();
    const orbits = new BinaryOrbitField({
      binaries,
      absolutePositions: catalog.positions,
      basePositions: this.deps.basePositions,
      velocities: catalog.velocities,
      absoluteMags: catalog.absmag,
      localPositions,
      compositeSuppress: this.compositeSuppress,
      iPositionAttr: attrs.iPositionAttr,
      iCompositeSuppressAttr: attrs.iCompositeSuppressAttr,
    });
    orbits.recenter(this.deps.worldOffset);
    // see eclipse/README.md#partial-re-upload
    this.eclipseDim.fill(1);
    uploadFull(attrs.iEclipseDimAttr);
    const eclipse = new EclipsePhotometryField({
      binaries,
      absolutePositions: catalog.positions,
      localPositions,
      absoluteMags: catalog.absmag,
      physicalRadiusSolar: catalog.physicalRadius,
      eclipseDimBuffer: this.eclipseDim,
      iEclipseDimAttr: attrs.iEclipseDimAttr,
    });
    this.attached.land({ data: binaries, orbits, eclipse });
  }

  markBaselinesDirty(): void {
    this.whenAttached((a) => a.orbits.markBaselinesDirty(), undefined);
  }

  /** True when the walk's sub-pixel gate collapsed this star onto its
   *  primary this frame — the renderer's own "these read as one point"
   *  verdict, so a system card keyed on it cannot disagree with the pixels. */
  isCompositeSuppressed(idx: number): boolean {
    return this.compositeSuppress[idx] === 1;
  }

  eclipseDimAt(idx: number): number {
    return this.eclipseDim[idx];
  }

  /** Debug-HUD view into the eclipse walk for the current camera, filter and
   *  sim time. Empty until a table is attached. */
  eclipseDebugRows(starIdx: number | null): EclipseRelationDebugRow[] {
    return this.whenAttached((a) => a.eclipse.debugRows(
      this.deps.getT(), this.deps.camera.position, this.deps.thresholdMag(), starIdx,
    ), []);
  }

  /** Active eclipse-dim slot count (occluding or decaying). */
  get eclipseActiveDimCount(): number {
    return this.whenAttached((a) => a.eclipse.activeDimCount, 0);
  }

  private walk(a: Attached): void {
    const { deps } = this;
    a.orbits.update(
      deps.getT(),
      deps.camera.position,
      deps.thresholdMag(),
      deps.uniforms.uViewport.value.y,
      deps.uniforms.uFovYRad.value,
      deps.focusedStar(),
    );
    deps.rideFocal(a.orbits);
    a.eclipse.update(deps.getT(), deps.camera.position, deps.thresholdMag(), performance.now());
  }

  private whenAttached<R>(ready: (a: Attached) => R, otherwise: R): R {
    const s = this.attached.state();
    return s.status === 'ready' ? ready(s.value) : otherwise;
  }

  private disposeFields(): void {
    this.whenAttached((a) => {
      a.orbits.dispose();
      a.eclipse.dispose();
    }, undefined);
  }

  private dispose(): void {
    for (const off of this.unsubscribe) off();
    this.disposeFields();
    this.orbitPaths.dispose();
  }
}
