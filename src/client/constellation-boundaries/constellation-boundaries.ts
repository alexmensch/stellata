// See README.md#the-owner.

import * as THREE from 'three';
import type { BoundaryArtifact } from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import type { ChromeLineMaterials } from '../chrome-lines/chrome-line-materials';
import type { ConstellationOfKind } from '../focus-card/constellation-row';
import { updateWarpGatedRefLayer, type SceneLayer } from '../scene/scene-layer';
import type { ScreenMetricUniforms } from '../util/orbit-line';
import { ConstellationBoundaryLayer } from './constellation-boundary-layer';
import {
  createConstellationRegions,
  type ConstellationLabelAnchor,
  type ConstellationNamer,
  type ConstellationTableEntry,
} from './constellation-regions';

export interface ConstellationBoundariesDeps {
  scene: Pick<THREE.Scene, 'add'>;
  /** Null when the artifact is missing or invalid: no arcs, no anchors, and
   *  no positional names, for the whole session. */
  artifact: BoundaryArtifact | null;
  constellations: readonly ConstellationTableEntry[];
  uniforms: ScreenMetricUniforms;
  chromeLines: ChromeLineMaterials;
  limitMag: () => number;
  onFilter: (handler: () => void) => () => void;
  /** The `constellationBoundaries` declutter floor. */
  permitted: () => boolean;
  localPositionInto: (kind: ConstellationOfKind, idx: number, out: THREE.Vector3) => boolean;
  worldOffset: Readonly<THREE.Vector3>;
}

export class ConstellationBoundaries {
  readonly entry: SceneLayer;
  /** Latin-name anchors for the chart label engine — one per IAU region, so
   *  Serpens carries two. */
  readonly labelAnchors: readonly ConstellationLabelAnchor[];
  private readonly layer: ConstellationBoundaryLayer;
  private readonly namer: ConstellationNamer | null;
  private readonly offFilter: () => void;
  private readonly abs = new THREE.Vector3();

  constructor(private readonly deps: ConstellationBoundariesDeps) {
    this.layer = new ConstellationBoundaryLayer(deps.uniforms, deps.chromeLines);
    deps.scene.add(this.layer.group);
    const regions = deps.artifact === null
      ? null : createConstellationRegions(deps.artifact, deps.constellations);
    if (deps.artifact !== null) this.layer.attach(deps.artifact, deps.limitMag());
    this.namer = regions?.namer ?? null;
    this.labelAnchors = regions?.labelAnchors ?? [];
    // The chart hard-clips at the instrument limit and inherits no exposure
    // state, so the EV trim must not move the fade window.
    this.offFilter = deps.onFilter(() => this.layer.setMagnitudeLimit(deps.limitMag()));
    this.entry = {
      // B1875 arcs on a Sol-centred sphere: a frozen-epoch partition. No term
      // in it is a function of t.
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      update: (ctx) => updateWarpGatedRefLayer(this.layer, ctx, deps.permitted()),
      setMonochrome: (on) => this.layer.setMonochrome(on),
      dispose: () => {
        this.offFilter();
        this.layer.dispose();
      },
    };
  }

  /** Sol-frame; null when there is nothing to name (README.md#the-owner). */
  constellationOf(kind: ConstellationOfKind, idx: number): string | null {
    if (this.namer === null) return null;
    if (!this.deps.localPositionInto(kind, idx, this.abs)) return null;
    return this.namer.nameAt(this.abs.add(this.deps.worldOffset));
  }
}
