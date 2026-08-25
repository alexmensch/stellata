// Test fixture builders for Cloud / CloudCatalog (the molecular-clouds
// analogue of loaders/catalog-mock.ts). Tests override only the fields
// they exercise.

import * as THREE from 'three';
import type { Cloud, CloudCatalog } from './cloud-loader';
import type { CloudAbsorptionSpec } from './cloud-materials';

export function makeMockCloud(overrides: Partial<Cloud> = {}): Cloud {
  return {
    name: 'Mock',
    id: 'mock',
    sid: 1,
    centerAbs: new THREE.Vector3(0, 0, 0),
    axes: [10, 10, 10],
    quat: new THREE.Quaternion(0, 0, 0, 1),
    source: 'Z2020',
    distanceFromSol: 100,
    massMsun: null,
    cloudClass: 'dark',
    n0Cal: 100,
    uEnv: 1,
    rflatPc: 1.2,
    p: 2,
    sigmaS: 1.3,
    seed: 12345,
    inGrid: true,
    embedded: [],
    ...overrides,
  };
}

export function makeMockCatalog(clouds: Cloud[]): CloudCatalog {
  return { count: clouds.length, clouds };
}

/** One cloud's absorption inputs, on either tier — `field` present is what
 *  selects the traced march on both backends. */
export function makeMockAbsorptionSpec(withField: boolean): CloudAbsorptionSpec {
  return {
    axes: new THREE.Vector3(3, 2, 1),
    n0Cal: 120,
    rflatPc: 0.4,
    p: 2.1,
    uEnv: 0.85,
    invQuat: new THREE.Matrix3(),
    steps: 14,
    field: withField
      ? {
        brick: new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2),
        densityMax: 7,
        centerFromAabb: new THREE.Vector3(1, 2, 3),
        rotMat: new THREE.Matrix3(),
        uvwScale: new THREE.Vector3(0.1, 0.1, 0.1),
        uvwBias: new THREE.Vector3(0.5, 0.5, 0.5),
      }
      : null,
  };
}

/** The rim's authored starting values, matching the layer's defaults. */
export const MOCK_RIM_SPEC = { inkHex: 0x000000, inkAlpha: 0.95, opacity: 1 };
