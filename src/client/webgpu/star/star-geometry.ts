// Packed instanced star geometry for the WebGPU port — 7 of the 8
// guaranteed vertex buffers (../README.md § Attribute packing).

import * as THREE from 'three';
import type { Catalog } from '../../loaders/catalog-loader';
import { interleavePulsParams } from '../../star-pipeline/pulsation/pulsation-params-pure';
import { STAR_QUAD_CORNERS, STAR_QUAD_INDEX } from '../../star-pipeline/star-pipeline';
import { buildPackedAttributes } from '../attribute-packing';
import { planVec4Packing, type Vec4PackPlan } from '../attribute-packing-pure';
import {
  STAR_DYNAMIC_SCALARS,
  STAR_PACK_PREFIX_DYNAMIC,
  STAR_PACK_PREFIX_STATIC,
  STAR_STATIC_SCALARS,
} from '../star-attribute-roster';

export interface StarGeometrySources {
  catalog: Catalog;
  logRadii: Float32Array;
  lumClassF32: Float32Array;
  distSol: Float32Array;
  teffApsis: Float32Array;
  boundingSphereRadiusPc: number;
  /** The shell-owned WebGL geometry's dynamic attributes. iPosition joins
   *  this geometry by object identity, so the shell's needsUpdate writes
   *  reach this renderer with no copy; the three scalars cannot (they
   *  interleave into iDyn0) and are version-watched by the layer. */
  iPositionAttr: THREE.InstancedBufferAttribute;
  iCompositeSuppressAttr: THREE.InstancedBufferAttribute;
  iEclipseDimAttr: THREE.InstancedBufferAttribute;
  iSuppressPulsationAttr: THREE.InstancedBufferAttribute;
}

export interface StarGeometryBuild {
  geometry: THREE.InstancedBufferGeometry;
  staticPlan: Vec4PackPlan;
  dynamicPlan: Vec4PackPlan;
  /** The packed DynamicDrawUsage buffers, in plan order — what a
   *  repackScalarInPlace caller flags for re-upload. */
  dynAttrs: THREE.InstancedBufferAttribute[];
}

/** Source attribute per dynamic packed scalar, in roster order. */
export function dynamicScalarSourceAttrs(
  s: StarGeometrySources,
): Record<(typeof STAR_DYNAMIC_SCALARS)[number], THREE.InstancedBufferAttribute> {
  return {
    iCompositeSuppress: s.iCompositeSuppressAttr,
    iEclipseDim: s.iEclipseDimAttr,
    iSuppressPulsation: s.iSuppressPulsationAttr,
  };
}

export function buildStarGeometry(s: StarGeometrySources): StarGeometryBuild {
  const count = s.catalog.count;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('aCorner', new THREE.BufferAttribute(STAR_QUAD_CORNERS, 2));
  geometry.setIndex(STAR_QUAD_INDEX);
  geometry.setAttribute('iPosition', s.iPositionAttr);
  geometry.setAttribute('iPuls', new THREE.InstancedBufferAttribute(
    interleavePulsParams(s.catalog.pulsRho, s.catalog.pulsColorSwing), 2));

  const staticPlan = planVec4Packing(STAR_STATIC_SCALARS, STAR_PACK_PREFIX_STATIC);
  const staticSources: Record<string, ArrayLike<number>> = {
    iAbsmag: s.catalog.absmag,
    iCi: s.catalog.ci,
    iSpectClass: s.catalog.spectClass,
    iLogRadius: s.logRadii,
    iPeriodDays: s.catalog.periodDays,
    iAmplitudeMag: s.catalog.amplitudeMag,
    iLumClass: s.lumClassF32,
    iDistSol: s.distSol,
    iTeffApsis: s.teffApsis,
  };
  for (const { name, attribute } of buildPackedAttributes(staticPlan, staticSources, count)) {
    geometry.setAttribute(name, attribute);
  }

  const dynamicPlan = planVec4Packing(STAR_DYNAMIC_SCALARS, STAR_PACK_PREFIX_DYNAMIC);
  const sourceAttrs = dynamicScalarSourceAttrs(s);
  const dynamicSources: Record<string, ArrayLike<number>> = Object.fromEntries(
    STAR_DYNAMIC_SCALARS.map((name) => [name, sourceAttrs[name].array]),
  );
  const dynAttrs: THREE.InstancedBufferAttribute[] = [];
  for (const { name, attribute } of buildPackedAttributes(dynamicPlan, dynamicSources, count)) {
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    dynAttrs.push(attribute);
  }

  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), s.boundingSphereRadiusPc);
  return { geometry, staticPlan, dynamicPlan, dynAttrs };
}
