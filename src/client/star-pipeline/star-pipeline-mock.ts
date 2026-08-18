// Zero-filled StarPipelineOptions for tests that need a real geometry
// (attribute roster, buffer accounting) without a GL context.

import * as THREE from 'three';
import { makeEmptyCatalog } from '../loaders/catalog-mock';
import { CATALOG_BOUNDING_RADIUS_PC } from './shards/star-shards-pure';
import type { StarPipelineOptions } from './star-pipeline';

export function makeStarPipelineOptions(count = 4): StarPipelineOptions {
  const catalog = makeEmptyCatalog(count);
  return {
    scene: new THREE.Scene(),
    catalog,
    logRadii: new Float32Array(count),
    lumClassF32: new Float32Array(count),
    distSol: new Float32Array(count),
    teffApsis: new Float32Array(count),
    localPositions: new Float32Array(count * 3),
    compositeSuppress: new Float32Array(count),
    eclipseDim: new Float32Array(count).fill(1),
    suppressPulsation: new Float32Array(count),
    vertexShader: 'void main(){ gl_Position = vec4(0.0); }',
    fragmentShader: 'void main(){}',
    sharedUniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
    },
    boundingSphereRadiusPc: CATALOG_BOUNDING_RADIUS_PC,
  };
}
