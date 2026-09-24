// The three coordinate spheres as one scene layer, plus the frame rule that
// gates them — README.md#a-frame-is-offered-where-it-describes-something.

import type * as THREE from 'three';
import {
  frameAfterFocusChange, frameAvailableFor, type FocusFrameInputs,
} from '../../attitude/attitude-pure';
import type { Target } from '../../camera/focus/focus-target';
import type { ChromeLineMaterials } from '../../chrome-lines/chrome-line-materials';
import type { SceneLayer } from '../../scene/scene-layer';
import type { CameraMode } from '../../stellata';
import { CoordSphere, type CoordSphereFrame, type DrawnCoordSphereFrame } from './coord-sphere';
import { COORD_SPHERE_SPECS, DRAWN_COORD_SPHERE_FRAMES } from './coord-sphere-frames';

export interface CoordSpheresDeps {
  scene: THREE.Scene;
  chromeLines: ChromeLineMaterials;
  coordSphere: () => CoordSphereFrame;
  setCoordSphere: (frame: CoordSphereFrame) => void;
  cameraMode: () => CameraMode;
  focusedTarget: () => Target | null;
  focusFrameInputs: (target: Target | null) => FocusFrameInputs;
  onFocus: (handler: (target: Target | null) => void) => () => void;
}

export class CoordSpheres {
  readonly entry: SceneLayer;

  private readonly deps: CoordSpheresDeps;

  constructor(deps: CoordSpheresDeps) {
    this.deps = deps;
    const spheres = Object.fromEntries(
      DRAWN_COORD_SPHERE_FRAMES.map((frame) =>
        [frame, new CoordSphere(COORD_SPHERE_SPECS[frame], deps.chromeLines)]),
    ) as Record<DrawnCoordSphereFrame, CoordSphere>;
    for (const frame of DRAWN_COORD_SPHERE_FRAMES) deps.scene.add(spheres[frame].group);

    const offFocus = deps.onFocus((target) => {
      const current = deps.coordSphere();
      const next = frameAfterFocusChange(current, deps.focusFrameInputs(target));
      if (next !== current) deps.setCoordSphere(next);
    });

    this.entry = {
      timeBehaviour: { kind: 'static' },
      contribution: { kind: 'always' },
      update: (ctx) => {
        for (const frame of DRAWN_COORD_SPHERE_FRAMES) {
          const sphere = spheres[frame];
          const on = !ctx.warpActive && this.drawn(frame);
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
  drawn(frame: DrawnCoordSphereFrame): boolean {
    return this.deps.coordSphere() === frame && this.deps.cameraMode() === 'observe';
  }

  /** Does `frame` describe anything real from whatever is focused? The `S`
   *  cycle, the panel's stop control and the focus-change demotion all gate on
   *  this, so none of them can select a frame the others would reject. */
  available(frame: DrawnCoordSphereFrame): boolean {
    return frameAvailableFor(frame, this.deps.focusFrameInputs(this.deps.focusedTarget()));
  }
}
