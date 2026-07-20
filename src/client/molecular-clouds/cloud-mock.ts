// Test fixture builders for Cloud / CloudCatalog (the molecular-clouds
// analogue of loaders/catalog-mock.ts). Tests override only the fields
// they exercise.

import * as THREE from 'three';
import type { Cloud, CloudCatalog } from './cloud-loader';
import type { NoiseModel } from './cloud-presence-pure';

/** The shipped noiseModel constants (scripts/clouds/cloud_model.py →
 *  clouds.json v2; pinned there by scripts/clouds/clouds-json.test.ts). */
export const MOCK_NOISE_MODEL: NoiseModel = {
  lacunarity: 2,
  betaSpectral: 2,
  lambdaMinPc: 0.3,
  domainStretchMajor: 2.5,
  noiseClampSigma: 2.5,
  ridgedFinestCount: 2,
  ridgedExponent: { dark: 2, sf: 3, hii: 3 },
  sigmaS: { dark: 1.3, sf: 1.7, hii: 1.9 },
};

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
  return { count: clouds.length, clouds, noiseModel: MOCK_NOISE_MODEL };
}
