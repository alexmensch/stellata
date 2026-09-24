// Galactic reference layers — see README.md § Wiring.

import * as THREE from 'three';
import {
  frameAfterFocusChange, frameAvailableFor, type FocusFrameInputs,
} from '../attitude/attitude-pure';
import type { Target } from '../camera/focus/focus-target';
import type { ChromeLineMaterials } from '../chrome-lines/chrome-line-materials';
import type { SceneElementId } from '../scene/declutter/scene-elements';
import { updateWarpGatedRefLayer, type SceneLayer } from '../scene/scene-layer';
import type { CameraMode } from '../stellata';
import {
  CoordSphere, type CoordSphereFrame, type DrawnCoordSphereFrame,
} from './coord-spheres/coord-sphere';
import { COORD_SPHERE_SPECS, DRAWN_COORD_SPHERE_FRAMES } from './coord-spheres/coord-sphere-frames';
import { GALACTIC_CENTRE_PC } from './galactic-coords';
import { GALACTIC_DISC_BOUND_PC, galacticDiscOpacity, type GalacticDisc } from './galactic-disc';

export interface GalacticReferenceDeps {
  /** Constructed and parented by the caller — README.md § Wiring. */
  disc: GalacticDisc;
  scene: THREE.Scene;
  chromeLines: ChromeLineMaterials;
  worldOffset: Readonly<THREE.Vector3>;
  detailPermits: (id: SceneElementId) => boolean;
  coordSphere: () => CoordSphereFrame;
  setCoordSphere: (frame: CoordSphereFrame) => void;
  cameraMode: () => CameraMode;
  focusedTarget: () => Target | null;
  focusFrameInputs: (target: Target | null) => FocusFrameInputs;
  onFocus: (handler: (target: Target | null) => void) => () => void;
}

export class GalacticReference {
  readonly discEntry: SceneLayer;
  readonly coordSpheresEntry: SceneLayer;

  private readonly deps: GalacticReferenceDeps;
  private readonly tmpBound = new THREE.Sphere();

  constructor(deps: GalacticReferenceDeps) {
    this.deps = deps;
    const { disc } = deps;
    const spheres = Object.fromEntries(
      DRAWN_COORD_SPHERE_FRAMES.map((frame) =>
        [frame, new CoordSphere(COORD_SPHERE_SPECS[frame], deps.chromeLines)]),
    ) as Record<DrawnCoordSphereFrame, CoordSphere>;
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) deps.scene.add(spheres[frame].group);

    // A frame the new focus gives no meaning to is demoted to that object's
    // own default rather than left measuring nothing — ../attitude/README.md
    // § Which frame, and who chooses.
    const offFocus = deps.onFocus((target) => {
      const current = deps.coordSphere();
      const next = frameAfterFocusChange(current, deps.focusFrameInputs(target));
      if (next !== current) deps.setCoordSphere(next);
    });

    this.discEntry = {
      timeBehaviour: { kind: 'static' },
      contribution: {
        kind: 'gated',
        // Opacity first: it is a scalar on `distFromSol` and it is what
        // fires at the app default view, where the camera sits inside the
        // ring and no frustum test could.
        skip: (ctx) => {
          if (galacticDiscOpacity(ctx.distFromSol) <= 0) return 'opacity';
          this.tmpBound.center.copy(GALACTIC_CENTRE_PC).sub(deps.worldOffset);
          this.tmpBound.radius = GALACTIC_DISC_BOUND_PC;
          return ctx.frustum.intersectsSphere(this.tmpBound) ? null : 'frustum';
        },
        setContributing: (on) => { disc.group.visible = on; },
      },
      update: (ctx) => updateWarpGatedRefLayer(
        disc, ctx, deps.detailPermits('galacticDiscWireframe')),
      setMonochrome: (on) => disc.setMonochrome(on),
      dispose: () => disc.dispose(),
    };
    this.coordSpheresEntry = {
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      update: (ctx) => {
        for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
          const sphere = spheres[frame];
          const on = !ctx.warpActive && this.coordSphereDrawn(frame);
          sphere.group.visible = on;
          if (on) sphere.update(ctx.camera.position);
        }
      },
      setMonochrome: (on) => {
        for (const frame of DRAWN_COORD_SPHERE_FRAMES) spheres[frame].setMonochrome(on);
      },
      dispose: () => {
        offFocus();
        for (const frame of DRAWN_COORD_SPHERE_FRAMES) spheres[frame].dispose();
      },
    };
  }

  /** Is `frame`'s sphere on screen? Observe mode only — in navigate the
   *  attitude indicator carries the frame instead, and two instruments
   *  answering "which way is north" at once is what let them drift apart.
   *  Warp gating is the layer's, not this: the SVG labels hide in warp
   *  through `body.warping` rather than through their own predicate. */
  coordSphereDrawn(frame: DrawnCoordSphereFrame): boolean {
    return this.deps.coordSphere() === frame && this.deps.cameraMode() === 'observe';
  }

  /** Does `frame` describe anything real from whatever is focused? The `S`
   *  cycle, the panel's stop control and the focus-change demotion all gate on
   *  this, so none of them can select a frame the others would reject. */
  coordSphereAvailable(frame: DrawnCoordSphereFrame): boolean {
    return frameAvailableFor(frame, this.deps.focusFrameInputs(this.deps.focusedTarget()));
  }
}
