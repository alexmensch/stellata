import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MolecularClouds, renderedCloudSizePx } from './molecular-clouds';
import type { Cloud, CloudCatalog } from './cloud-loader';
import type { CloudSurface } from './cloud-surfaces-loader';
import { makeMockCloud, makeMockCatalog } from './cloud-mock';
import { bindAttachmentGate } from '../hdr/attachments/attachment-gate';
import {
  DEFAULT_FACE_ON_FLOOR,
  DEFAULT_FRESNEL_POWER,
  SHELL_RIM_ALPHA_LIMB,
} from '../fresnel-shell/fresnel-shell';

/** The render hooks take three's full callback signature and ignore all of
 *  it; firing them is the whole test. */
const NO_RENDER_ARGS = [] as unknown as Parameters<THREE.Object3D['onBeforeRender']>;

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

  it('keeps group renderOrder at 0 so per-mesh renderOrder sorts against the MW band', () => {
    // Group.renderOrder becomes the three.js groupOrder, which outranks
    // per-mesh renderOrder in the transparent sort — a non-zero value
    // here draws the whole cloud pass before the MW band (group 0,
    // meshes −3) and the band paints over the absorption.
    const c = new MolecularClouds(makeCatalog());
    expect(c.group.renderOrder).toBe(0);
    expect(absorptionGroup(c).renderOrder).toBe(0);
    expect(rimGroup(c).renderOrder).toBe(0);
    for (const m of absorptionGroup(c).children) expect(m.renderOrder).toBe(-2);
    for (const m of rimGroup(c).children) expect(m.renderOrder).toBe(-1);
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

  // The light an absorber dims is in attachment 2 now
  // (../hdr/summation/README.md), and the gate's default keeps it shut. A
  // draw that never opens it multiplies an attachment holding nothing: no
  // error, no dark rift. Both halves of the contract are pinned because
  // either alone is silent.
  it('opens the absorption gate around every absorption draw', () => {
    const log: string[] = [];
    bindAttachmentGate((a) => log.push(`open:${a}`), () => log.push('close'));
    try {
      const c = new MolecularClouds(makeCatalog());
      for (const m of absorptionGroup(c).children) {
        m.onBeforeRender(...NO_RENDER_ARGS);
        m.onAfterRender(...NO_RENDER_ARGS);
      }
    } finally {
      bindAttachmentGate(null, null);
    }
    expect(log).toEqual(['open:absorption', 'close', 'open:absorption', 'close']);
  });

  it('writes the same texel to attachment 2 that it writes to attachment 0', () => {
    const frag = readFileSync(
      fileURLToPath(new URL('./cloud-absorption.frag.glsl', import.meta.url)),
      'utf8',
    );
    expect(frag).toContain('layout(location = 2) out vec4 outDiffuse;');
    expect(frag).toContain('outDiffuse = outColor;');
  });

  it('setSteps clamps into the shader budget', () => {
    const c = new MolecularClouds(makeCatalog());
    c.setSteps(100);
    for (const m of absorptionMaterials(c)) expect(m.uniforms.uSteps.value).toBe(24);
    c.setSteps(1);
    for (const m of absorptionMaterials(c)) expect(m.uniforms.uSteps.value).toBe(4);
  });

  it('traced clouds march the density brick (USE_FIELD); fallbacks stay analytic', () => {
    const catalog = makeCatalog();
    const surfaces = new Map([[catalog.clouds[0].sid, makeSurface()]]);
    const c = new MolecularClouds(catalog, surfaces);
    const [matA, matB] = absorptionMaterials(c);
    expect(matA.defines).toHaveProperty('USE_FIELD');
    expect(matA.uniforms.uBrick.value).toBeInstanceOf(THREE.Data3DTexture);
    expect(matA.uniforms.uDensityMax.value).toBeCloseTo(0.05, 7);
    // Field mode clips at the brick's taper edge, not the analytic uEnv.
    expect(matA.uniforms.uUEnv.value).toBeCloseTo(1.05, 12);
    // Texel-centre uvw mapping: scale = 1/(step·dims), bias = 0.5/dims.
    const scale = matA.uniforms.uUvwScale.value as THREE.Vector3;
    expect(scale.x).toBeCloseTo(1 / (5 * 2), 12);
    expect(scale.y).toBeCloseTo(1 / (5 * 1), 12);
    const bias = matA.uniforms.uUvwBias.value as THREE.Vector3;
    expect(bias.x).toBeCloseTo(0.25, 12);
    expect(matB.defines).not.toHaveProperty('USE_FIELD');
    expect(matB.uniforms.uUEnv.value).toBe(catalog.clouds[1].uEnv);
    expect(matB.uniforms.uBrick).toBeUndefined();
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
  ): number | null {
    c.group.updateMatrixWorld(true);
    const cam = cameraAt(origin, origin.clone().add(dir));
    const hit = c.pick(cam, ORIGIN, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad);
    return hit?.idx ?? null;
  }

  // Screen-pixel position a world point projects to under `cam`.
  function screenOf(p: THREE.Vector3, cam: THREE.PerspectiveCamera): [number, number] {
    const v = p.clone().project(cam);
    return [(v.x + 1) * 0.5 * VIEWPORT_W, (1 - v.y) * 0.5 * VIEWPORT_H];
  }

  const down = new THREE.Vector3(0, 0, -1);

  it('hits a traced cloud only where its shell is, not across the ellipsoid envelope', () => {
    // makeSurface is a ~1 pc triangle (0,0,0)-(1,0,0)-(0,1,0) in a radius-10 bbox.
    const c = new MolecularClouds(catalog, new Map([[1, makeSurface()]]));
    // Through the triangle (x + y < 1): a hit.
    expect(pickAlongForward(c, new THREE.Vector3(0.25, 0.25, 5), down)).toBe(0);
    // Well inside the radius-10 ellipsoid but clear of the triangle: a miss.
    // The former ellipsoid hitbox would have returned 0 here.
    expect(pickAlongForward(c, new THREE.Vector3(5, 5, 5), down)).toBeNull();
  });

  it('falls back to the u = uEnv ellipsoid for clouds with no traced surface', () => {
    const c = new MolecularClouds(catalog); // no surfaces
    // Origins sit outside the radius-10 sphere; the FrontSide rim is a
    // hide-when-inside shell, so a ray must enter through a front face.
    expect(pickAlongForward(c, new THREE.Vector3(5, 5, 20), down)).toBe(0); // crosses r = 10
    expect(pickAlongForward(c, new THREE.Vector3(20, 0, 20), down)).toBeNull(); // clears it
  });

  it('reports the effective-centre camera distance at the fallback hover tier', () => {
    const c = new MolecularClouds(catalog);
    c.group.updateMatrixWorld(true);
    const cam = cameraAt(new THREE.Vector3(0, 0, 30), ORIGIN);
    const hit = c.pick(cam, ORIGIN, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad);
    expect(hit?.idx).toBe(0);
    expect(hit?.tier).toBe('fallback');
    expect(hit?.cameraDistancePc).toBeCloseTo(30, 6);
  });

  it('projects against the floating-origin-shifted centre', () => {
    const c = new MolecularClouds(makeMockCatalog([
      makeMockCloud({ centerAbs: new THREE.Vector3(1000, 0, 0), axes: [10, 10, 10] }),
    ]));
    const worldOffset = new THREE.Vector3(1000, 0, 0);
    c.update(worldOffset, true);
    c.group.updateMatrixWorld(true);
    const cam = cameraAt(new THREE.Vector3(0, 0, 30), ORIGIN);
    const hit = c.pick(cam, worldOffset, rect, VIEWPORT_W / 2, VIEWPORT_H / 2, pxPerRad);
    expect(hit?.idx).toBe(0);
    expect(hit?.cameraDistancePc).toBeCloseTo(30, 6);
  });

  // Both clouds enclose the cursor in each case below: a small cloud
  // 200 pc from the camera, nested on screen inside a 10× bigger complex
  // twice as far away. "Closest to camera wins" made the big complex
  // unreachable through the small one's silhouette.
  describe('overlapping clouds — proportionally deepest inside wins', () => {
    const overlapping = makeMockCatalog([
      makeMockCloud({ name: 'big', id: 'big', sid: 1, axes: [100, 100, 100] }),
      makeMockCloud({
        name: 'small', id: 'small', sid: 2, axes: [10, 10, 10],
        centerAbs: new THREE.Vector3(9, 0, 200),
      }),
    ]);

    function pickThrough(target: THREE.Vector3, catalog = overlapping): number | null {
      const c = new MolecularClouds(catalog);
      c.group.updateMatrixWorld(true);
      const cam = cameraAt(new THREE.Vector3(0, 0, 400), ORIGIN);
      const [x, y] = screenOf(target, cam);
      return c.pick(cam, ORIGIN, rect, x, y, pxPerRad)?.idx ?? null;
    }

    it('the small foreground cloud wins at its own centre', () => {
      expect(pickThrough(new THREE.Vector3(9, 0, 200))).toBe(1);
    });

    it('the big complex wins near the small cloud edge, despite being further away', () => {
      // 85 % of the way to the small cloud edge (score ≈ 0.85) while
      // still only ~35 % of the way out of the big complex.
      const edgeOfSmall = new THREE.Vector3(17.5, 0, 200);
      expect(pickThrough(edgeOfSmall)).toBe(0);
      // The small cloud really is under the cursor there — on its own it
      // takes the pick, so the big complex won an overlap rather than a
      // walkover.
      const smallOnly = makeMockCatalog([overlapping.clouds[1]]);
      expect(pickThrough(edgeOfSmall, smallOnly)).toBe(0);
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
    const c = new MolecularClouds(makeMockCatalog([
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
    const c = new MolecularClouds(catalog, surfaces);
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
    const c = new MolecularClouds(makeMockCatalog([
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
    const c = new MolecularClouds(catalog, surfaces);
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
