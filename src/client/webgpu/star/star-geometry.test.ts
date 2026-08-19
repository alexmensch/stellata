import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAX_VERTEX_BUFFERS } from '../star-attribute-roster';
import { buildStarGeometry } from './star-geometry';
import { makeStarGeometrySources } from './star-sources-mock';

const packed = (g: THREE.InstancedBufferGeometry, name: string) =>
  (g.getAttribute(name) as THREE.InstancedBufferAttribute).array as Float32Array;

describe('buildStarGeometry', () => {
  it('lands on 7 vertex buffers, one under the WebGPU limit', () => {
    const { sources } = makeStarGeometrySources();
    const { geometry } = buildStarGeometry(sources);
    const names = Object.keys(geometry.attributes).sort();
    expect(names).toEqual(
      ['aCorner', 'iDyn0', 'iPack0', 'iPack1', 'iPack2', 'iPosition', 'iPuls'],
    );
    expect(names.length).toBe(MAX_VERTEX_BUFFERS - 1);
  });

  it('joins the WebGL iPosition and iPuls attributes by object identity', () => {
    const { sources, pipe } = makeStarGeometrySources();
    const { geometry } = buildStarGeometry(sources);
    expect(geometry.getAttribute('iPosition')).toBe(pipe.iPositionAttr);
    expect(geometry.getAttribute('iPuls')).toBe(pipe.iPulsAttr);
  });

  it('interleaves static scalars into their planned slots', () => {
    const { sources, opts } = makeStarGeometrySources();
    opts.catalog.absmag[2] = 5.5; // roster slot 0 → iPack0.x
    sources.distSol[1] = 42;      // roster slot 7 → iPack1.w
    const { geometry } = buildStarGeometry(sources);
    expect(packed(geometry, 'iPack0')[2 * 4 + 0]).toBe(5.5);
    expect(packed(geometry, 'iPack1')[1 * 4 + 3]).toBe(42);
  });

  it('interleaves the dynamic scalars into iDyn0, flagged DynamicDrawUsage', () => {
    const { sources } = makeStarGeometrySources();
    // iCompositeSuppress → .x, iEclipseDim → .y (mock fills eclipseDim 1).
    (sources.iCompositeSuppressAttr.array as Float32Array)[3] = 1;
    const { geometry, dynAttrs } = buildStarGeometry(sources);
    expect(dynAttrs).toHaveLength(1);
    expect(dynAttrs[0].usage).toBe(THREE.DynamicDrawUsage);
    expect(packed(geometry, 'iDyn0')[3 * 4 + 0]).toBe(1);
    expect(packed(geometry, 'iDyn0')[2 * 4 + 1]).toBe(1);
  });

  it('carries the instance count and bounding sphere', () => {
    const { sources } = makeStarGeometrySources(6);
    const { geometry } = buildStarGeometry(sources);
    expect(geometry.instanceCount).toBe(6);
    expect(geometry.boundingSphere?.radius).toBe(sources.boundingSphereRadiusPc);
  });
});
