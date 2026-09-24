import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MolecularClouds, renderedCloudSizePx } from './molecular-clouds';
import type { Cloud, CloudCatalog } from './cloud-loader';
import type { CloudSurface } from './cloud-surfaces-loader';
import {
  fakeCloudMaterials, makeMockCatalog, makeMockCloud, type FakeCloudMaterials,
} from './cloud-mock';

function makeCloud(axes: [number, number, number], id = 'test'): Cloud {
  return makeMockCloud({ name: id, id, sid: id.charCodeAt(0), axes });
}

// Two-cloud stub catalog so the per-cloud loops in setMonochrome / the
// levers all run with more than one cloud.
function makeCatalog(): CloudCatalog {
  return makeMockCatalog([makeCloud([10, 10, 10], 'A'), makeCloud([22, 19, 9.5], 'B')]);
}

// A tiny valid surface mesh (one triangle + a 2×1×1 brick) for
// sid-keyed rim / field-absorption tests.
function makeSurface(): CloudSurface {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    brick: {
      dims: [2, 1, 1],
      aabbMinAbs: [-5, -5, -5],
      stepPc: 5,
      densityMax: 0.05,
      data: new Uint8Array([255, 128]),
    },
  };
}

/** A layer over the recording double, with the double handed back. */
function makeClouds(
  catalog: CloudCatalog = makeCatalog(),
  surfaces: Map<number, CloudSurface> | null = null,
): { c: MolecularClouds; materials: FakeCloudMaterials } {
  const materials = fakeCloudMaterials();
  return { c: new MolecularClouds(catalog, surfaces, materials), materials };
}

function absorptionGroup(c: MolecularClouds): THREE.Group {
  return c.group.children[0] as THREE.Group;
}
function rimGroup(c: MolecularClouds): THREE.Group {
  return c.group.children[1] as THREE.Group;
}
function rimMaterial(c: MolecularClouds): THREE.Material {
  return (rimGroup(c).children[0] as THREE.Mesh).material as THREE.Material;
}

describe('MolecularClouds / absorption material contract', () => {
  it('keeps group renderOrder at 0 so per-mesh renderOrder sorts against the MW band', () => {
    // Group.renderOrder becomes the three.js groupOrder, which outranks
    // per-mesh renderOrder in the transparent sort — a non-zero value
    // here draws the whole cloud pass before the MW band (group 0,
    // meshes −3) and the band paints over the absorption.
    const { c } = makeClouds(makeCatalog());
    expect(c.group.renderOrder).toBe(0);
    expect(absorptionGroup(c).renderOrder).toBe(0);
    expect(rimGroup(c).renderOrder).toBe(0);
    for (const m of absorptionGroup(c).children) expect(m.renderOrder).toBe(-2);
    for (const m of rimGroup(c).children) expect(m.renderOrder).toBe(-1);
  });

  it('stays visible regardless of the rim declutter permit (physics, always on)', () => {
    const { c } = makeClouds(makeCatalog());
    c.update(new THREE.Vector3(), false);
    expect(absorptionGroup(c).visible).toBe(true);
    expect(rimGroup(c).visible).toBe(false);
    c.update(new THREE.Vector3(), true);
    expect(absorptionGroup(c).visible).toBe(true);
    expect(rimGroup(c).visible).toBe(true);
  });

  it('hides only in chart mode', () => {
    const { c } = makeClouds(makeCatalog());
    c.setMonochrome(true);
    c.update(new THREE.Vector3(), true);
    expect(absorptionGroup(c).visible).toBe(false);
    expect(rimGroup(c).visible).toBe(true); // the stippled outline
    c.setMonochrome(false);
    c.update(new THREE.Vector3(), true);
    expect(absorptionGroup(c).visible).toBe(true);
  });

  it('setSteps clamps into the shader budget', () => {
    const { c, materials } = makeClouds();
    const steps = () => materials.absorptionSurfaces.map((s) => s.uniforms.uSteps.value);
    c.setSteps(100);
    expect(steps()).toEqual([24, 24]);
    c.setSteps(1);
    expect(steps()).toEqual([4, 4]);
  });

  // The tier is the layer's call — it owns the brick texture's lifetime —
  // and it is compile-time, so a spec naming the wrong
  // envelope marches it from the material's first frame
  // (README.md#the-material-seam).
  it('hands the traced cloud a field spec and the fallback none', () => {
    const catalog = makeCatalog();
    const { materials } = makeClouds(
      catalog, new Map([[catalog.clouds[0].sid, makeSurface()]]));
    const [traced, fallback] = materials.absorptionSpecs;
    expect(traced.field).not.toBeNull();
    expect(traced.field!.brick).toBeInstanceOf(THREE.Data3DTexture);
    expect(traced.field!.densityMax).toBeCloseTo(0.05, 7);
    // Field mode clips at the brick's taper edge, not the analytic uEnv.
    expect(traced.uEnv).toBeCloseTo(1.05, 12);
    // Texel-centre uvw mapping: scale = 1/(step·dims), bias = 0.5/dims.
    expect(traced.field!.uvwScale.x).toBeCloseTo(1 / (5 * 2), 12);
    expect(traced.field!.uvwScale.y).toBeCloseTo(1 / (5 * 1), 12);
    expect(traced.field!.uvwBias.x).toBeCloseTo(0.25, 12);
    expect(fallback.field).toBeNull();
    expect(fallback.uEnv).toBe(catalog.clouds[1].uEnv);
  });
});

describe('MolecularClouds / rim shell contract', () => {
  // One material for every cloud, so a rim lever cannot reach one and miss
  // the rest. The surface's own state is the factory's, pinned in
  // `../webgpu/molecular-clouds/tsl-cloud-materials.test.ts`.
  it('draws every cloud through one shared material', () => {
    const { c } = makeClouds();
    const mats = rimGroup(c).children.map((m) => (m as THREE.Mesh).material);
    expect(mats[1]).toBe(mats[0]);
  });

  it('swaps to the stippled ink pass (normal blending) in chart mode and back', () => {
    const { c, materials } = makeClouds();
    const rim = materials.rimSurface.uniforms;
    c.setMonochrome(true);
    expect(rimMaterial(c).blending).toBe(THREE.NormalBlending);
    expect(rim.uChart.value).toBe(1);
    c.setMonochrome(false);
    expect(rimMaterial(c).blending).toBe(THREE.AdditiveBlending);
    expect(rim.uChart.value).toBe(0);
  });

  it('uses the traced isosurface when the sid has one, ellipsoid fallback otherwise', () => {
    const catalog = makeCatalog();
    const sidA = catalog.clouds[0].sid;
    const surfaces = new Map([[sidA, makeSurface()]]);
    const { c } = makeClouds(catalog, surfaces);
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
    const { c, materials } = makeClouds();
    const opacity = () => materials.rimSurface.uniforms.uOpacity.value;
    c.setOpacity(0.4);
    expect(opacity()).toBe(0.4);
    c.setDebugBoost(25);
    expect(opacity()).toBe(25);
    c.setDebugBoost(null);
    expect(opacity()).toBe(0.4);
  });

  it('label samples: traced meshes subsample their vertices, fallbacks sweep the envelope', () => {
    const catalog = makeCatalog();
    const sidA = catalog.clouds[0].sid;
    const surfaces = new Map([[sidA, makeSurface()]]);
    const { c } = makeClouds(catalog, surfaces);
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
    const { c } = makeClouds(makeCatalog());
    const out = new THREE.Vector3();
    c.labelSampleInto(0, 0, new THREE.Vector3(5, -3, 2), out);
    const raw = new THREE.Vector3();
    c.labelSampleInto(0, 0, new THREE.Vector3(0, 0, 0), raw);
    expect(out.x).toBeCloseTo(raw.x - 5, 12);
    expect(out.y).toBeCloseTo(raw.y + 3, 12);
    expect(out.z).toBeCloseTo(raw.z - 2, 12);
  });

  it('setMonoColor / setMonoOpacity drive the chart ink uniforms', () => {
    const { c, materials } = makeClouds();
    const rim = materials.rimSurface.uniforms;
    c.setMonoColor(0x336699);
    c.setMonoOpacity(0.5);
    expect((rim.uInk.value as THREE.Color).getHex()).toBe(0x336699);
    expect(rim.uInkAlpha.value).toBe(0.5);
  });
});

describe('MolecularClouds / picking geometry', () => {
  const catalog = makeMockCatalog([
    makeMockCloud({ name: 'A', id: 'a', sid: 1, axes: [10, 10, 10] }),
  ]);

  const VIEWPORT_W = 800;
  const VIEWPORT_H = 600;
  const FOV_DEG = 60;
  const rect = { left: 0, top: 0, width: VIEWPORT_W, height: VIEWPORT_H } as DOMRect;
  const pxPerRad = VIEWPORT_H / ((FOV_DEG * Math.PI) / 180);
  const ORIGIN = new THREE.Vector3();

  function cameraAt(position: THREE.Vector3, lookAt: THREE.Vector3): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(FOV_DEG, VIEWPORT_W / VIEWPORT_H, 1e-6, 1e6);
    cam.position.copy(position);
    cam.lookAt(lookAt);
    cam.updateMatrixWorld();
    return cam;
  }

  // Cursor at the exact viewport centre, so the pick ray is the camera's
  // forward axis — the direct analogue of the raycaster the pick path
  // builds in the app.
  function pickAlongForward(
    c: MolecularClouds,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    rimPermitted = true,
  ): number | null {
    c.update(ORIGIN, rimPermitted);
    c.group.updateMatrixWorld(true);
    const cam = cameraAt(origin, origin.clone().add(dir));
    const hit = c.pick(cam, ORIGIN, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad, 0);
    return hit?.idx ?? null;
  }

  function liveClouds(cat: CloudCatalog, worldOffset: THREE.Vector3 = ORIGIN): MolecularClouds {
    const { c } = makeClouds(cat);
    c.update(worldOffset, true);
    c.group.updateMatrixWorld(true);
    return c;
  }

  // Screen-pixel position a world point projects to under `cam`.
  function screenOf(p: THREE.Vector3, cam: THREE.PerspectiveCamera): [number, number] {
    const v = p.clone().project(cam);
    return [(v.x + 1) * 0.5 * VIEWPORT_W, (1 - v.y) * 0.5 * VIEWPORT_H];
  }

  const down = new THREE.Vector3(0, 0, -1);

  it('hits a traced cloud only where its shell is, not across the ellipsoid envelope', () => {
    // makeSurface is a ~1 pc triangle (0,0,0)-(1,0,0)-(0,1,0) in a radius-10 bbox.
    const { c } = makeClouds(catalog, new Map([[1, makeSurface()]]));
    // Through the triangle (x + y < 1): a hit.
    expect(pickAlongForward(c, new THREE.Vector3(0.25, 0.25, 5), down)).toBe(0);
    // Well inside the radius-10 ellipsoid but clear of the triangle: a miss.
    // The former ellipsoid hitbox would have returned 0 here.
    expect(pickAlongForward(c, new THREE.Vector3(5, 5, 5), down)).toBeNull();
  });

  it('falls back to the u = uEnv ellipsoid for clouds with no traced surface', () => {
    const { c } = makeClouds(catalog); // no surfaces
    // Origins sit outside the radius-10 sphere; the FrontSide rim is a
    // hide-when-inside shell, so a ray must enter through a front face.
    expect(pickAlongForward(c, new THREE.Vector3(5, 5, 20), down)).toBe(0); // crosses r = 10
    expect(pickAlongForward(c, new THREE.Vector3(20, 0, 20), down)).toBeNull(); // clears it
  });

  describe('declutter gate — the rim is the only mark the layer paints', () => {
    const inside = new THREE.Vector3(5, 5, 20);

    it('refuses a hit the rim would have taken, below the representational floor', () => {
      const { c } = makeClouds(catalog);
      expect(pickAlongForward(c, inside, down, true)).toBe(0);
      expect(pickAlongForward(c, inside, down, false)).toBeNull();
    });

    it('keeps the chart-mode stipple outline pickable — the rim mesh still draws', () => {
      const { c } = makeClouds(catalog);
      c.setMonochrome(true);
      expect(pickAlongForward(c, inside, down, true)).toBe(0);
      expect(pickAlongForward(c, inside, down, false)).toBeNull();
    });

    it('refuses a pick before the first update states the permit', () => {
      const { c } = makeClouds(catalog);
      c.group.updateMatrixWorld(true);
      const cam = cameraAt(inside, inside.clone().add(down));
      expect(c.pick(cam, ORIGIN, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad, 0)).toBeNull();
    });

    it('re-arms the sentinel on dispose, so a late tick never raycasts dead geometry', () => {
      const c = liveClouds(catalog);
      const cam = cameraAt(inside, inside.clone().add(down));
      expect(c.pick(cam, ORIGIN, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad, 0)?.idx).toBe(0);
      c.dispose();
      expect(rimGroup(c).visible).toBe(false);
      expect(c.pick(cam, ORIGIN, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad, 0)).toBeNull();
    });
  });

  it('reports the effective-centre camera distance at the extended hover tier', () => {
    const c = liveClouds(catalog);
    const cam = cameraAt(new THREE.Vector3(0, 0, 30), ORIGIN);
    const hit = c.pick(cam, ORIGIN, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad, 0);
    expect(hit?.idx).toBe(0);
    expect(hit?.enclosureRadiusPx).toBeGreaterThan(0);
    expect(hit?.cameraDistancePc).toBeCloseTo(30, 6);
  });

  it('projects against the floating-origin-shifted centre', () => {
    const worldOffset = new THREE.Vector3(1000, 0, 0);
    const c = liveClouds(makeMockCatalog([
      makeMockCloud({ centerAbs: new THREE.Vector3(1000, 0, 0), axes: [10, 10, 10] }),
    ]), worldOffset);
    const cam = cameraAt(new THREE.Vector3(0, 0, 30), ORIGIN);
    const hit = c.pick(cam, worldOffset, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad, 0);
    expect(hit?.idx).toBe(0);
    expect(hit?.cameraDistancePc).toBeCloseTo(30, 6);
  });

  // Both clouds enclose the cursor in each case below: a small cloud
  // 200 pc from the camera, nested on screen inside a 10× bigger complex
  // twice as far away. The tighter silhouette answers wherever the cursor
  // is inside both, and the big complex keeps everything beyond it.
  describe('overlapping clouds — the tighter silhouette wins', () => {
    const overlapping = makeMockCatalog([
      makeMockCloud({ name: 'big', id: 'big', sid: 1, axes: [100, 100, 100] }),
      makeMockCloud({
        name: 'small', id: 'small', sid: 2, axes: [10, 10, 10],
        centerAbs: new THREE.Vector3(9, 0, 200),
      }),
    ]);

    function pickThrough(target: THREE.Vector3, catalog = overlapping): number | null {
      const c = liveClouds(catalog);
      const cam = cameraAt(new THREE.Vector3(0, 0, 400), ORIGIN);
      const [x, y] = screenOf(target, cam);
      return c.pick(cam, ORIGIN, rect, x, y, pxPerRad, 0)?.idx ?? null;
    }

    it('the small foreground cloud wins at its own centre', () => {
      expect(pickThrough(new THREE.Vector3(9, 0, 200))).toBe(1);
    });

    it('the small cloud keeps the pick right out to its own rim', () => {
      // 85 % of the way to the small cloud's edge while still only ~35 %
      // of the way out of the big complex. Ranking on how deep the cursor
      // sits handed this to the big one, which left the small cloud's
      // whole outer half unreachable.
      const edgeOfSmall = new THREE.Vector3(17.5, 0, 200);
      expect(pickThrough(edgeOfSmall)).toBe(1);
      // The small cloud really is under the cursor there — on its own it
      // takes the pick, so this is an overlap it won rather than a
      // walkover.
      const smallOnly = makeMockCatalog([overlapping.clouds[1]]);
      expect(pickThrough(edgeOfSmall, smallOnly)).toBe(0);
    });

    it('the big complex keeps everywhere the small silhouette does not cover', () => {
      expect(pickThrough(new THREE.Vector3(30, 0, 200))).toBe(0);
    });
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

  it('sizes the depicted u = uEnv envelope, not the bare Zucker axes', () => {
    const angularToPx = 1000;
    const dCam = 100;
    const uEnv = 0.25;
    const tightened = renderedCloudSizePx(
      makeMockCloud({ axes: [8, 8, 8], uEnv }), dCam, angularToPx);
    expect(tightened).toBeCloseTo(2 * Math.atan((8 * uEnv) / dCam) * angularToPx, 12);
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

describe('effective focus geometry', () => {
  it('fallback clouds anchor at the ellipsoid centroid with the envelope extent', () => {
    const { c } = makeClouds(makeMockCatalog([
      makeMockCloud({ centerAbs: new THREE.Vector3(50, -20, 30), axes: [10, 4, 2], uEnv: 0.5 }),
    ]));
    const out = new THREE.Vector3();
    expect(c.focusCenterAbsInto(0, out)).toBe(true);
    expect(out.x).toBe(50);
    expect(c.focusExtentPc(0)).toBeCloseTo(10 * 0.5, 12);
  });

  it('traced clouds anchor at the mesh vertex centroid with the max vertex radius', () => {
    // One triangle far from the ellipsoid centre: centroid = vertex mean.
    const catalog = makeMockCatalog([
      makeMockCloud({ centerAbs: new THREE.Vector3(100, 0, 0), axes: [30, 30, 30] }),
    ]);
    const surfaces = new Map([[catalog.clouds[0].sid, {
      ...makeSurface(),
      positions: new Float32Array([90, 0, 0, 96, 0, 0, 93, 3, 0]),
    }]]);
    const { c } = makeClouds(catalog, surfaces);
    const out = new THREE.Vector3();
    c.focusCenterAbsInto(0, out);
    expect(out.x).toBeCloseTo(93, 5);
    expect(out.y).toBeCloseTo(1, 5);
    // Farthest vertex from (93, 1, 0): (90, 0, 0) or (96, 0, 0) at √10.
    expect(c.focusExtentPc(0)).toBeCloseTo(Math.sqrt(10), 5);
    // cloudLocalPositionInto follows the effective centre too.
    c.cloudLocalPositionInto(0, new THREE.Vector3(3, 1, 0), out);
    expect(out.x).toBeCloseTo(90, 5);
    expect(out.y).toBeCloseTo(0, 5);
  });

  it('viewingDistancePc keys off the effective extent with the 5 pc floor', () => {
    const { c } = makeClouds(makeMockCatalog([
      makeMockCloud({ axes: [10, 1, 1] }),
      makeMockCloud({ id: 'tiny', sid: 2, axes: [0.5, 0.5, 0.5] }),
    ]));
    expect(c.viewingDistancePc(0)).toBeCloseTo(24, 6);
    expect(c.viewingDistancePc(1)).toBeCloseTo(5.0, 6);
  });

  it('renderedSizePx uses the extent sphere for traced clouds, the quadric otherwise', () => {
    const catalog = makeMockCatalog([
      makeCloud([10, 1, 1], 'A'),
      makeCloud([10, 1, 1], 'B'),
    ]);
    const surfaces = new Map([[catalog.clouds[0].sid, makeSurface()]]);
    const { c } = makeClouds(catalog, surfaces);
    const angularToPx = 1000;
    const endOn = new THREE.Vector3(1, 0, 0);
    // Traced: sphere of the mesh extent — viewDir is irrelevant.
    const traced = c.renderedSizePx(0, 100, angularToPx, endOn);
    expect(traced).toBeCloseTo(
      2 * Math.atan(c.focusExtentPc(0) / 100) * angularToPx, 9);
    // Fallback: the tight ellipsoid quadric (end-on prolate → short axis).
    const fallback = c.renderedSizePx(1, 100, angularToPx, endOn);
    expect(fallback).toBeCloseTo(
      renderedCloudSizePx(catalog.clouds[1], 100, angularToPx, endOn), 9);
  });
});

describe('MolecularClouds / what the cloudAbsorption lever may price', () => {
  const drawnAfter = (mutate: (c: MolecularClouds) => void) => {
    const { c } = makeClouds(makeCatalog());
    c.update(new THREE.Vector3(), false);
    mutate(c);
    return c.isAbsorptionDrawn();
  };

  it('draws from a contributing layer with absorption on', () => {
    expect(drawnAfter(() => {})).toBe(true);
  });

  // The legibility skip hides the parent group and stops `update` running, so
  // the raymarch is already gone — an A/B against it would disable a pass
  // that is not there and read a meaningless zero.
  it('does not draw while the contribution gate has skipped the layer', () => {
    expect(drawnAfter((c) => c.setContributing(false))).toBe(false);
  });

  // The kill switch only sets a field; `update` is what carries it to the
  // group, so the lever's own restore depends on a contributing frame.
  it('does not draw once the kill switch has reached the group', () => {
    expect(drawnAfter((c) => {
      c.setAbsorptionEnabled(false);
      c.update(new THREE.Vector3(), false);
    })).toBe(false);
  });

  it('does not draw in chart mode', () => {
    expect(drawnAfter((c) => c.setMonochrome(true))).toBe(false);
  });
});
