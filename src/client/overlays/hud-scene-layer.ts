// The HUD's registry entry — see ../galactic/README.md#hud.

import * as THREE from 'three';
import type { FocusController } from '../camera/focus/focus-controller';
import type { FilterState } from '../filters/filter-state';
import type { SceneLayer } from '../scene/scene-layer';
import type { HudOverlay, HudUpdateOpts } from './hud-overlay';

export interface HudSceneLayerDeps {
  hud: HudOverlay;
  camera: THREE.PerspectiveCamera;
  /** `controls.target` — the origin only while nothing is focused. */
  target: THREE.Vector3;
  solIndex: number;
  focus: Pick<FocusController, 'focalLocalPositionInto' | 'getFocusedStar' | 'getCameraMode'>;
  filter: () => Readonly<FilterState>;
  observeProgress: () => HudUpdateOpts['transition'];
  focusedDiscRadiusPx: () => number;
}

export function hudSceneLayer(deps: HudSceneLayerDeps): SceneLayer {
  const { hud, camera, focus } = deps;
  const focalLocal = new THREE.Vector3();
  return {
    // Pure projection: it reads the focal position and projects arrow
    // tips, adding no motion of its own. Whatever it points at is
    // bounded by the layer that OWNS that object — which is why every
    // focusable kind has to declare a rate, not just the ones that
    // happen to be pinnable today.
    timeBehaviour: { kind: 'static' },
    contribution: { kind: 'always' },
    update: (ctx) => {
      if (ctx.warpActive) {
        hud.setVisible(false);
        return;
      }
      // Matrices before any projection: ../galactic/README.md#hud.
      camera.updateMatrixWorld();
      const filter = deps.filter();
      const focusedStar = focus.getFocusedStar();
      hud.update({
        enabled: filter.showHud,
        camera,
        target: deps.target,
        // Never controls.target while focused: ../galactic/README.md#hud.
        focusedLocal: focus.focalLocalPositionInto(focalLocal) ? focalLocal : null,
        hideSolArrow: focusedStar !== null && focusedStar === deps.solIndex,
        sizeMaxPx: filter.sizeMax,
        cameraMode: focus.getCameraMode(),
        transition: deps.observeProgress(),
        focusedDiscRadiusPx: deps.focusedDiscRadiusPx(),
        w: window.innerWidth,
        h: window.innerHeight,
      });
    },
    setMonochrome: (on) => hud.setMonochrome(on),
    dispose: () => hud.dispose(),
  };
}
