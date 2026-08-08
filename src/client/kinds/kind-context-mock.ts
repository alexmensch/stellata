// KindContext test fixture builder shared by the kind-module suites.

import * as THREE from 'three';
import { angularToPx } from '../camera/controls/star-geometry';
import type { HdrEmitterUniforms } from '../hdr/hdr-pipeline';
import type { SharedUniforms } from '../frame/shared-uniforms';
import type { KindContext } from './kind-module';

export const MOCK_VIEWPORT_W = 800;
export const MOCK_VIEWPORT_H = 600;
export const MOCK_FOV_Y_RAD = (50 * Math.PI) / 180;

/** Unit-valued HDR emitter slots for module suites — the production
 *  seeds (`makeHdrEmitterUniforms`) carry calibrated exposure /
 *  white-point values the fixtures deliberately flatten to 1. */
export function makeMockHdrEmitterUniforms(): HdrEmitterUniforms {
  return {
    uHdrTarget: { value: 0 },
    uWhitePoint: { value: 1 },
    uHighlightDesat: { value: 0 },
    uExposure: { value: 1 },
    uOmegaPxArcsec2: { value: 1 },
  };
}

export function makeKindContext(overrides: Partial<KindContext> = {}): KindContext {
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
  const sharedUniforms = {
    uViewport: { value: new THREE.Vector2(MOCK_VIEWPORT_W, MOCK_VIEWPORT_H) },
    uPixelRatio: { value: 1 },
    uFovYRad: { value: MOCK_FOV_Y_RAD },
    uHideFocusIdx: { value: -1 },
    // The HDR emitter slots ride the shared map by reference in
    // production (frame/README.md § Shared uniforms).
    ...makeMockHdrEmitterUniforms(),
  } as unknown as SharedUniforms;
  return {
    scene: new THREE.Scene(),
    camera,
    canvas: {
      getBoundingClientRect: () => ({
        left: 0, top: 0, width: MOCK_VIEWPORT_W, height: MOCK_VIEWPORT_H,
      } as DOMRect),
    } as unknown as HTMLElement,
    sharedUniforms,
    solIndex: 0,
    solAbsInto: (out) => {
      out.set(0, 0, 0);
      return true;
    },
    angularToPx: () => angularToPx(MOCK_VIEWPORT_H, MOCK_FOV_Y_RAD),
    starPhotometry: () => null,
    systemMembership: {
      membersOf: () => [],
      collapsedClusterOf: () => [],
    },
    getT: () => 0,
    getWorldOffset: () => new THREE.Vector3(),
    getFocusedTarget: () => null,
    getMonochrome: () => false,
    detailPermits: () => true,
    constellationOf: () => null,
    onFrame: () => () => {},
    ...overrides,
  };
}
