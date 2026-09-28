// See README.md#the-owner.

import type * as THREE from 'three';
import type { CameraMode } from '../camera/focus/focus-controller';
import type { ChromeLineMaterials } from '../chrome-lines/chrome-line-materials';
import type { FilterState } from '../filters/filter-state';
import type { Constellation } from '../loaders/catalog-loader';
import type { CadenceReport } from '../render-gate/cadence/clock-cadence-pure';
import type { CadenceCtx, SceneLayer } from '../scene/scene-layer';
import { ConstellationFigureLayer } from './constellation-figure-layer';
import { figureAimPoint, selectFigures } from './constellation-figure-pure';

export interface ConstellationFigureDeps {
  scene: Pick<THREE.Scene, 'add'>;
  chromeLines: ChromeLineMaterials;
  constellations: readonly Constellation[];
  localPositions: Float32Array;
  localPositionInto: (idx: number, out: THREE.Vector3) => THREE.Vector3;
  absmag: ArrayLike<number>;
  filter: () => Readonly<Pick<FilterState, 'chart' | 'highlightCon'>>;
  cameraMode: () => CameraMode;
  observeAnchorStar: () => number | null;
  onState: (handler: () => void) => () => void;
  /** A figure vertex may be a binary member, so the figure moves at the
   *  binaries' rate (../scene/README.md#anchored-content-declares-its-anchors-rate). */
  rate: (cc: CadenceCtx) => CadenceReport;
}

export class ConstellationFigure {
  readonly entry: SceneLayer;
  private readonly layer: ConstellationFigureLayer;
  private readonly offState: () => void;
  // Poison: no selection signature is empty, so the first refresh rebuilds.
  private signature = '';

  constructor(private readonly deps: ConstellationFigureDeps) {
    this.layer = new ConstellationFigureLayer(deps.chromeLines);
    deps.scene.add(this.layer.group);
    this.offState = deps.onState(() => this.refresh());
    this.refresh();
    this.entry = {
      timeBehaviour: { kind: 'clock', rate: deps.rate },
      contribution: { kind: 'always' },
      update: () => this.layer.update(deps.localPositions),
      setMonochrome: (on) => this.layer.setMonochrome(on),
      dispose: () => {
        this.offState();
        this.layer.dispose();
        this.signature = '';
      },
    };
  }

  /** The `constellationFigures` declutter floor. */
  setPermitted(on: boolean): void {
    this.layer.setPermitted(on);
  }

  /** README.md#the-aim-point, judged from `from`. Null when the index names no
   *  figure with a vertex. */
  aimPoint(conIndex: number, from: Readonly<THREE.Vector3>): THREE.Vector3 | null {
    return figureAimPoint(this.deps.constellations[conIndex]?.lines, {
      localPositionInto: this.deps.localPositionInto,
      absmag: this.deps.absmag,
      from,
    });
  }

  private refresh(): void {
    const { chart, highlightCon } = this.deps.filter();
    const sel = selectFigures({
      chart,
      highlightCon,
      constellationCount: this.deps.constellations.length,
      inObserve: this.deps.cameraMode() === 'observe',
      observeAnchorStar: this.deps.observeAnchorStar(),
    });
    if (sel.signature === this.signature) return;
    this.signature = sel.signature;
    this.layer.setFigures(
      this.deps.constellations, sel.conIndices, this.deps.localPositions, sel.excludeStarIdx);
  }
}
