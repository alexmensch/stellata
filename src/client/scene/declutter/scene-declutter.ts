// Live declutter permission cache. See scene/declutter/README.md § The contract.

import {
  type DetailLevel,
  type RenderStyle,
  type SceneElementId,
  SCENE_ELEMENT_FLOORS,
  SCENE_ELEMENT_IDS,
  floorPermits,
} from './scene-elements';

export type DetailPushes = Partial<Record<SceneElementId, (on: boolean) => void>>;

export interface SceneDeclutterDeps {
  /** Pushes for layers with no per-frame gate to pull the cache from. */
  pushes: readonly DetailPushes[];
  setMilkyWayEnabled(on: boolean): void;
  setLgEmissionEnabled(on: boolean): void;
  showLgEmission(): boolean;
}

export class SceneDeclutter {
  private readonly permitted = Object.fromEntries(
    SCENE_ELEMENT_IDS.map((id) => [id, true]),
  ) as Record<SceneElementId, boolean>;

  private readonly pushes: DetailPushes = {};

  constructor(private readonly deps: SceneDeclutterDeps) {
    for (const source of deps.pushes) {
      for (const [id, push] of Object.entries(source) as [SceneElementId, DetailPushes[SceneElementId]][]) {
        if (!push) continue;
        if (this.pushes[id]) throw new Error(`scene element '${id}' has two declutter pushes`);
        this.pushes[id] = push;
      }
    }
  }

  permits(id: SceneElementId): boolean { return this.permitted[id]; }

  applyFloors(level: DetailLevel, style: RenderStyle): void {
    for (const id of SCENE_ELEMENT_IDS) {
      this.setPermitted(id, floorPermits(SCENE_ELEMENT_FLOORS[id][style], level));
    }
  }

  private setPermitted(id: SceneElementId, on: boolean): void {
    this.permitted[id] = on;
    this.pushes[id]?.(on);
    if (id === 'milkyWayBand' || id === 'milkyWayIsobar') this.applyMilkyWayEnabled();
    if (id === 'lgEmissionGlow') this.refreshLgEmission();
  }

  refreshLgEmission(): void {
    this.deps.setLgEmissionEnabled(this.permitted.lgEmissionGlow && this.deps.showLgEmission());
  }

  private applyMilkyWayEnabled(): void {
    this.deps.setMilkyWayEnabled(this.permitted.milkyWayBand || this.permitted.milkyWayIsobar);
  }
}
