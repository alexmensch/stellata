// Test fixture builders for Cloud / CloudCatalog (the molecular-clouds
// analogue of loaders/catalog-mock.ts). Tests override only the fields
// they exercise.

import * as THREE from 'three';
import type { Cloud, CloudCatalog } from './cloud-loader';

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
