import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MolecularClouds, renderedCloudSizePx, cloudViewingDistancePc } from './molecular-clouds';
import type { Cloud, CloudCatalog } from './cloud-loader';
import { MAX_OCTAVES } from './cloud-presence-pure';
import { makeMockCloud, makeMockCatalog } from './cloud-mock';

function makeCloud(axes: [number, number, number], id = 'test'): Cloud {
  return makeMockCloud({ name: id, id, sid: id.charCodeAt(0), axes });
}

// Two-cloud stub catalog so the per-cloud loops in setMonochrome /
// setIsobar / the levers all run with `materials.length > 1`.
function makeCatalog(): CloudCatalog {
  return makeMockCatalog([makeCloud([10, 10, 10], 'A'), makeCloud([22, 19, 9.5], 'B')]);
}

function materials(c: MolecularClouds): THREE.ShaderMaterial[] {
  return c.group.children.map(
    (m) => (m as THREE.Mesh).material as THREE.ShaderMaterial,
  );
}

describe('MolecularClouds / presence material contract', () => {
  const u1 = { value: 7.5 };

  it('always blends premultiplied-over (NormalBlending), in every mode', () => {
    // One draw carries both components: rgb = additive rim glow, alpha =
    // absorption. Additive blending would drop the absorption term.
    const c = new MolecularClouds(makeCatalog());
    const expectNormal = () => {
      for (const m of materials(c)) {
        expect(m.blending).toBe(THREE.NormalBlending);
        expect(m.premultipliedAlpha).toBe(true);
        expect(m.side).toBe(THREE.BackSide);
      }
    };
    expectNormal();
    c.setMonochrome(true);
    expectNormal();
    c.setIsobar(true, u1);
    expectNormal();
    c.setMonochrome(false);
    c.setIsobar(false, u1);
    expectNormal();
  });

  it('setMonochrome swaps the uMonochrome flag and the uOpacity value', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setMonochrome(true);
    for (const m of materials(c)) {
      expect(m.uniforms.uMonochrome.value).toBe(1);
      expect(m.uniforms.uOpacity.value).toBe(0.95);
    }
    c.setMonochrome(false);
    for (const m of materials(c)) {
      expect(m.uniforms.uMonochrome.value).toBe(0);
      expect(m.uniforms.uOpacity.value).toBe(1);
    }
  });

  it('builds the per-cloud octave ladder inside the uniform budget', () => {
    const c = new MolecularClouds(makeCatalog());
    for (const m of materials(c)) {
      const lambdas = m.uniforms.uOctLambda.value as number[];
      const amps = m.uniforms.uOctAmp.value as number[];
      const n = m.uniforms.uNumOct.value as number;
      expect(lambdas).toHaveLength(MAX_OCTAVES);
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(MAX_OCTAVES);
      // Padding beyond uNumOct is zero and never read by the shader loops.
      expect(lambdas[n]).toBe(0);
      const total = amps.slice(0, n).reduce((a, b) => a + b * b, 0);
      expect(total).toBeCloseTo(1, 10);
    }
    // Cloud B: major diameter 44 pc → the pinned Taurus ladder head.
    expect((materials(c)[1].uniforms.uOctLambda.value as number[])[0]).toBe(44);
  });

  it('setIsobar binds the magnitude-uniform reference', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setIsobar(true, u1);
    for (const m of materials(c)) {
      expect(m.uniforms.uMaxAppMag).toBe(u1);
    }
  });

  it('setIsobar with the same magnitude uniform repeated does not silently rebind', () => {
    // The cached boundMagUniform short-circuits the rebind when the
    // wrapper hasn't changed. Verify no-op-ness by re-asserting
    // identity after a no-change call.
    const c = new MolecularClouds(makeCatalog());
    c.setIsobar(true, u1);
    c.setIsobar(true, u1);
    for (const m of materials(c)) {
      expect(m.uniforms.uMaxAppMag).toBe(u1);
    }
  });

  it('shares uFovYRad / uViewport by reference when provided', () => {
    const shared = {
      uMaxAppMag: { value: 6.5 },
      uFovYRad: { value: 0.9 },
      uViewport: { value: new THREE.Vector2(800, 600) },
    };
    const c = new MolecularClouds(makeCatalog(), shared);
    for (const m of materials(c)) {
      expect(m.uniforms.uFovYRad).toBe(shared.uFovYRad);
      expect(m.uniforms.uViewport).toBe(shared.uViewport);
      expect(m.uniforms.uMaxAppMag).toBe(shared.uMaxAppMag);
    }
  });

  it('setDebugBoost overrides and restores the glow gain', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setDebugBoost(25);
    for (const m of materials(c)) expect(m.uniforms.uOpacity.value).toBe(25);
    c.setDebugBoost(null);
    for (const m of materials(c)) expect(m.uniforms.uOpacity.value).toBe(1);
  });
});

describe('renderedCloudSizePx', () => {
  it('picks the largest semi-axis regardless of which slot it lives in', () => {
    const angularToPx = 1000; // arbitrary; cancels out across the comparison
    const dCam = 100;
    const xMax = renderedCloudSizePx(makeCloud([10, 1, 1]), dCam, angularToPx);
    const yMax = renderedCloudSizePx(makeCloud([1, 10, 1]), dCam, angularToPx);
    const zMax = renderedCloudSizePx(makeCloud([1, 1, 10]), dCam, angularToPx);
    expect(xMax).toBeCloseTo(yMax, 9);
    expect(yMax).toBeCloseTo(zMax, 9);
    // …and is strictly larger than a uniformly small cloud at the same distance.
    const small = renderedCloudSizePx(makeCloud([1, 1, 1]), dCam, angularToPx);
    expect(xMax).toBeGreaterThan(small);
  });

  it('matches the angular-diameter formula 2·atan(R/d)·angularToPx', () => {
    const angularToPx = 600 / Math.PI; // viewport_y / fovYRad with H=600, fov=180°
    const dCam = 50;
    const cloud = makeCloud([5, 2, 2]); // largest axis = 5
    const expected = 2 * Math.atan(5 / dCam) * angularToPx;
    expect(renderedCloudSizePx(cloud, dCam, angularToPx)).toBeCloseTo(expected, 12);
  });

  it('stays finite as the camera approaches the centroid', () => {
    // 1e-30 floor on dCam keeps atan well-defined without artificially capping
    // the silhouette diameter; very-close camera produces near-π·angularToPx.
    const angularToPx = 1000;
    const out = renderedCloudSizePx(makeCloud([5, 5, 5]), 0, angularToPx);
    expect(Number.isFinite(out)).toBe(true);
    expect(out).toBeGreaterThan(0);
  });

  it('uses the perpendicular axes when a viewDir is supplied (prolate end-on)', () => {
    // Cloud of axes [10, 1, 1] viewed end-on along the long axis: the
    // silhouette is a circle of radius 1, NOT 10. With viewDir omitted
    // the helper falls back to max axis (= 10) — that's the legacy
    // conservative answer. With viewDir = [1,0,0] the helper should
    // tighten the bound to 1.
    const angularToPx = 1000;
    const dCam = 100;
    const cloud = makeCloud([10, 1, 1]);
    const endOn = new THREE.Vector3(1, 0, 0); // along long axis (cloud-local x)
    const sideOn = new THREE.Vector3(0, 1, 0); // perpendicular to long axis

    const noDir = renderedCloudSizePx(cloud, dCam, angularToPx);
    const endOnPx = renderedCloudSizePx(cloud, dCam, angularToPx, endOn);
    const sideOnPx = renderedCloudSizePx(cloud, dCam, angularToPx, sideOn);

    // Side-on still sees the full long axis (silhouette radius = 10).
    expect(sideOnPx).toBeCloseTo(noDir, 6);
    // End-on should be ~10× tighter — silhouette radius drops from 10 to 1.
    expect(endOnPx).toBeLessThan(noDir / 5);
    // ...specifically matching 2·atan(1/100)·angularToPx.
    const expectedEndOn = 2 * Math.atan(1 / dCam) * angularToPx;
    expect(endOnPx).toBeCloseTo(expectedEndOn, 9);
  });

  it('reduces to the legacy max-axis when the cloud is a sphere', () => {
    const angularToPx = 1000;
    const dCam = 100;
    const cloud = makeCloud([5, 5, 5]);
    const someDir = new THREE.Vector3(0.6, 0.5, 0.4).normalize();
    const noDir = renderedCloudSizePx(cloud, dCam, angularToPx);
    const withDir = renderedCloudSizePx(cloud, dCam, angularToPx, someDir);
    expect(withDir).toBeCloseTo(noDir, 9);
  });
});

describe('cloudViewingDistancePc', () => {
  it('keys off the largest semi-axis with a 5 pc floor', () => {
    expect(cloudViewingDistancePc(makeCloud([10, 1, 1]))).toBeCloseTo(24, 6);
    expect(cloudViewingDistancePc(makeCloud([0.5, 0.5, 0.5]))).toBeCloseTo(5.0, 6);
  });
});
