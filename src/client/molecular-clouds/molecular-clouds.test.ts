import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MolecularClouds, renderedCloudSizePx, cloudViewingDistancePc } from './molecular-clouds';
import type { Cloud, CloudCatalog } from './cloud-loader';
import type { CloudSurface } from './cloud-surfaces-loader';
import { makeMockCloud, makeMockCatalog } from './cloud-mock';
import {
  DEFAULT_FACE_ON_FLOOR,
  DEFAULT_FRESNEL_POWER,
  SHELL_RIM_ALPHA_LIMB,
} from '../fresnel-shell/fresnel-shell';

function makeCloud(axes: [number, number, number], id = 'test'): Cloud {
  return makeMockCloud({ name: id, id, sid: id.charCodeAt(0), axes });
}

// Two-cloud stub catalog so the per-cloud loops in setMonochrome / the
// levers all run with more than one cloud.
function makeCatalog(): CloudCatalog {
  return makeMockCatalog([makeCloud([10, 10, 10], 'A'), makeCloud([22, 19, 9.5], 'B')]);
}

// A tiny valid surface mesh (one triangle) for sid-keyed rim tests.
function makeSurface(): CloudSurface {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

function absorptionGroup(c: MolecularClouds): THREE.Group {
  return c.group.children[0] as THREE.Group;
}
function rimGroup(c: MolecularClouds): THREE.Group {
  return c.group.children[1] as THREE.Group;
}
function absorptionMaterials(c: MolecularClouds): THREE.ShaderMaterial[] {
  return absorptionGroup(c).children.map(
    (m) => (m as THREE.Mesh).material as THREE.ShaderMaterial,
  );
}
function rimMaterial(c: MolecularClouds): THREE.ShaderMaterial {
  return (rimGroup(c).children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
}

describe('MolecularClouds / absorption material contract', () => {
  it('is an alpha-only premultiplied-over BackSide draw, in every mode', () => {
    const c = new MolecularClouds(makeCatalog());
    const expectContract = () => {
      for (const m of absorptionMaterials(c)) {
        expect(m.blending).toBe(THREE.NormalBlending);
        expect(m.premultipliedAlpha).toBe(true);
        expect(m.side).toBe(THREE.BackSide);
      }
    };
    expectContract();
    c.setMonochrome(true);
    expectContract();
    c.setMonochrome(false);
    expectContract();
  });

  it('stays visible regardless of the rim declutter permit (physics, always on)', () => {
    const c = new MolecularClouds(makeCatalog());
    c.update(new THREE.Vector3(), false);
    expect(absorptionGroup(c).visible).toBe(true);
    expect(rimGroup(c).visible).toBe(false);
    c.update(new THREE.Vector3(), true);
    expect(absorptionGroup(c).visible).toBe(true);
    expect(rimGroup(c).visible).toBe(true);
  });

  it('hides only in chart mode', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setMonochrome(true);
    c.update(new THREE.Vector3(), true);
    expect(absorptionGroup(c).visible).toBe(false);
    expect(rimGroup(c).visible).toBe(true); // the stippled outline
    c.setMonochrome(false);
    c.update(new THREE.Vector3(), true);
    expect(absorptionGroup(c).visible).toBe(true);
  });

  it('setSteps clamps into the shader budget', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setSteps(100);
    for (const m of absorptionMaterials(c)) expect(m.uniforms.uSteps.value).toBe(24);
    c.setSteps(1);
    for (const m of absorptionMaterials(c)) expect(m.uniforms.uSteps.value).toBe(4);
  });

  it('shares uFovYRad / uViewport by reference when provided', () => {
    const shared = {
      uFovYRad: { value: 0.9 },
      uViewport: { value: new THREE.Vector2(800, 600) },
    };
    const c = new MolecularClouds(makeCatalog(), null, shared);
    for (const m of absorptionMaterials(c)) {
      expect(m.uniforms.uFovYRad).toBe(shared.uFovYRad);
      expect(m.uniforms.uViewport).toBe(shared.uViewport);
    }
  });
});

describe('MolecularClouds / rim shell contract', () => {
  it('is one shared FrontSide material, additive, at the Local Bubble rim params', () => {
    const c = new MolecularClouds(makeCatalog());
    const mats = rimGroup(c).children.map(
      (m) => (m as THREE.Mesh).material as THREE.ShaderMaterial,
    );
    expect(mats[1]).toBe(mats[0]);
    expect(mats[0].side).toBe(THREE.FrontSide);
    expect(mats[0].blending).toBe(THREE.AdditiveBlending);
    expect(mats[0].uniforms.uChart.value).toBe(0);
    expect(mats[0].uniforms.uAlphaLimb.value).toBe(SHELL_RIM_ALPHA_LIMB);
    expect(mats[0].uniforms.uFaceOnFloor.value).toBe(DEFAULT_FACE_ON_FLOOR);
    expect(mats[0].uniforms.uFresnelPower.value).toBe(DEFAULT_FRESNEL_POWER);
  });

  it('swaps to the stippled ink pass (normal blending) in chart mode and back', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setMonochrome(true);
    expect(rimMaterial(c).blending).toBe(THREE.NormalBlending);
    expect(rimMaterial(c).uniforms.uChart.value).toBe(1);
    c.setMonochrome(false);
    expect(rimMaterial(c).blending).toBe(THREE.AdditiveBlending);
    expect(rimMaterial(c).uniforms.uChart.value).toBe(0);
  });

  it('uses the traced isosurface when the sid has one, ellipsoid fallback otherwise', () => {
    const catalog = makeCatalog();
    const sidA = catalog.clouds[0].sid;
    const surfaces = new Map([[sidA, makeSurface()]]);
    const c = new MolecularClouds(catalog, surfaces);
    const meshA = rimGroup(c).children[0] as THREE.Mesh;
    const meshB = rimGroup(c).children[1] as THREE.Mesh;
    // Traced mesh: absolute positions baked in, no per-mesh transform.
    expect(meshA.geometry.getAttribute('position').count).toBe(3);
    expect(meshA.position.length()).toBe(0);
    expect(meshA.scale.x).toBe(1);
    // Fallback: shared unit sphere scaled to the density envelope.
    expect(meshB.position.x).toBe(catalog.clouds[1].centerAbs.x);
    expect(meshB.scale.x).toBeCloseTo(catalog.clouds[1].axes[0] * catalog.clouds[1].uEnv, 12);
  });

  it('setOpacity / setDebugBoost drive and restore the rim gain', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setOpacity(0.4);
    expect(rimMaterial(c).uniforms.uOpacity.value).toBe(0.4);
    c.setDebugBoost(25);
    expect(rimMaterial(c).uniforms.uOpacity.value).toBe(25);
    c.setDebugBoost(null);
    expect(rimMaterial(c).uniforms.uOpacity.value).toBe(0.4);
  });

  it('label samples: traced meshes subsample their vertices, fallbacks sweep the envelope', () => {
    const catalog = makeCatalog();
    const sidA = catalog.clouds[0].sid;
    const surfaces = new Map([[sidA, makeSurface()]]);
    const c = new MolecularClouds(catalog, surfaces);
    // Cloud A (3-vertex surface): every vertex is a sample.
    expect(c.labelSampleCount(0)).toBe(3);
    const out = new THREE.Vector3();
    c.labelSampleInto(0, 1, new THREE.Vector3(0, 0, 0), out);
    expect(out.x).toBe(1); // surface vertex 1 = (1, 0, 0)
    // Cloud B (fallback): fixed sweep of the u = uEnv envelope.
    expect(c.labelSampleCount(1)).toBe(32);
    const b = catalog.clouds[1];
    for (let i = 0; i < c.labelSampleCount(1); i++) {
      c.labelSampleInto(1, i, new THREE.Vector3(0, 0, 0), out);
      const local = out.clone().sub(b.centerAbs).applyQuaternion(b.quat.clone().conjugate());
      const u = Math.sqrt(
        (local.x / (b.axes[0] * b.uEnv)) ** 2
        + (local.y / (b.axes[1] * b.uEnv)) ** 2
        + (local.z / (b.axes[2] * b.uEnv)) ** 2,
      );
      // Samples are stored float32, so ~7 significant digits survive.
      expect(u).toBeCloseTo(1, 6);
    }
  });

  it('labelSampleInto subtracts the world offset', () => {
    const c = new MolecularClouds(makeCatalog());
    const out = new THREE.Vector3();
    c.labelSampleInto(0, 0, new THREE.Vector3(5, -3, 2), out);
    const raw = new THREE.Vector3();
    c.labelSampleInto(0, 0, new THREE.Vector3(0, 0, 0), raw);
    expect(out.x).toBeCloseTo(raw.x - 5, 12);
    expect(out.y).toBeCloseTo(raw.y + 3, 12);
    expect(out.z).toBeCloseTo(raw.z - 2, 12);
  });

  it('setMonoColor / setMonoOpacity drive the chart ink uniforms', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setMonoColor(0x336699);
    c.setMonoOpacity(0.5);
    expect((rimMaterial(c).uniforms.uInk.value as THREE.Color).getHex()).toBe(0x336699);
    expect(rimMaterial(c).uniforms.uInkAlpha.value).toBe(0.5);
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
