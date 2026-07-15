import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { LgEmission, LgObject } from './local-group-loader';
import {
  buildEmissionInstanceData,
  cpuDensityAt,
  cpuRaymarchColumn,
  cpuSersicNu,
  emissionComponents,
  emissionStepsFor,
  intensityFromMag,
  magFromIntensity,
  DISC_COLOR_RGB,
  EMISSION_STEPS_DISC,
  EMISSION_STEPS_SERSIC,
  SPHEROID_COLOR_RGB,
  type DiscComponent,
  type SersicComponent,
} from './local-group-emission-pure';
import { LocalGroupEmission } from './local-group-emission';

const SMC_EMISSION: LgEmission = {
  family: 'sersic',
  mV: 2.2,
  reffAxesPc: [812.82, 1080.85, 1307.48],
  n: 1,
  bn: 1.676543,
  pn: 0.44493,
  uMax: 4.589,
  density0: 0.098503652,
};

const LMC_EMISSION: LgEmission = {
  family: 'disc',
  mV: 0.4,
  rdPc: 1500,
  zdPc: 1000 / 3,
  rEnvPc: 6000,
  zEnvPc: 4000 / 3,
  density0: 0.20821438,
};

const M31_EMISSION: LgEmission = {
  family: 'disc',
  mV: 3.44,
  rdPc: 5300,
  zdPc: 500 / 3,
  rEnvPc: 21200,
  zEnvPc: 2000 / 3,
  density0: 0.34273291,
  bulge: {
    reffAxesPc: [1000, 1000, 1000],
    n: 2.2,
    bn: 4.071156,
    pn: 0.734151,
    uMax: 9.9748,
    density0: 24.0568,
  },
};

const LMC_DISC = emissionComponents(LMC_EMISSION)[0] as DiscComponent;
const SMC_SPHEROID = emissionComponents(SMC_EMISSION)[0] as SersicComponent;

function lgObject(name: string, emission: LgEmission, center: [number, number, number]): LgObject {
  return {
    name,
    id: name.toLowerCase(),
    sid: 1,
    centerAbs: new THREE.Vector3(...center),
    kind: emission.family === 'disc' ? 'disc' : 'ellipsoid',
    axes: [1000, 1000, 1000],
    quat: new THREE.Quaternion(0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)),
    source: 'OVERRIDE',
    distanceFromSol: Math.hypot(...center),
    emission,
  };
}

describe('emissionComponents', () => {
  it('a Sérsic block is one spheroid component with uMax × R_e axes', () => {
    const comps = emissionComponents(SMC_EMISSION);
    expect(comps).toHaveLength(1);
    const c = comps[0] as SersicComponent;
    expect(c.family).toBe('sersic');
    expect(c.axesPc[0]).toBeCloseTo(4.589 * 812.82, 6);
    expect(c.axesPc[2]).toBeCloseTo(4.589 * 1307.48, 6);
    expect(c.invN).toBe(1);
    expect(c.density0).toBe(SMC_EMISSION.density0);
  });

  it('a bulge-less disc block is one disc component on the envelope axes', () => {
    const comps = emissionComponents(LMC_EMISSION);
    expect(comps).toHaveLength(1);
    const c = comps[0] as DiscComponent;
    expect(c.family).toBe('disc');
    expect(c.axesPc).toEqual([6000, 6000, 4000 / 3]);
    expect(c.rdPc).toBe(1500);
  });

  it('a disc + bulge block decomposes into a disc and a spheroid on the bulge sphere', () => {
    const comps = emissionComponents(M31_EMISSION);
    expect(comps).toHaveLength(2);
    expect(comps[0].family).toBe('disc');
    const b = comps[1] as SersicComponent;
    expect(b.family).toBe('sersic');
    expect(b.axesPc[0]).toBeCloseTo(9.9748 * 1000, 3);
    expect(b.axesPc[1]).toBe(b.axesPc[0]);
    expect(b.density0).toBeCloseTo(24.0568, 4);
    expect(b.invN).toBeCloseTo(1 / 2.2, 9);
    expect(b.uMax).toBeCloseTo(9.9748, 4);
  });

  it('per-family march density: discs step denser than spheroids', () => {
    expect(emissionStepsFor(LMC_DISC)).toBe(EMISSION_STEPS_DISC);
    expect(emissionStepsFor(SMC_SPHEROID)).toBe(EMISSION_STEPS_SERSIC);
    expect(EMISSION_STEPS_SERSIC).toBe(32);
    expect(EMISSION_STEPS_DISC).toBe(64);
  });
});

describe('buildEmissionInstanceData', () => {
  const objects = [
    lgObject('SMC', SMC_EMISSION, [10_000, 0, -60_000]),
    lgObject('LMC', LMC_EMISSION, [15_000, 5_000, -42_000]),
    lgObject('M31', M31_EMISSION, [300_000, 500_000, 400_000]),
  ];
  const { sersic, disc } = buildEmissionInstanceData(objects);

  it('splits by component family and remembers source indices', () => {
    // M31 contributes to BOTH passes: its disc plus its bulge spheroid.
    expect(sersic.count).toBe(2);
    expect(disc.count).toBe(2);
    expect(sersic.objectIndex).toEqual([0, 2]);
    expect(disc.objectIndex).toEqual([1, 2]);
  });

  it('spheroid mesh axes are uMax × R_e; params pack as (density0, 1/n, bn, pn)', () => {
    expect(sersic.axes[0]).toBeCloseTo(4.589 * 812.82, 1);
    expect(sersic.axes[2]).toBeCloseTo(4.589 * 1307.48, 1);
    expect(sersic.sersic[0]).toBeCloseTo(SMC_EMISSION.density0, 7);
    expect(sersic.sersic[1]).toBe(1);
    expect(sersic.sersic[2]).toBeCloseTo(1.676543, 6);
    expect(sersic.uMax[0]).toBeCloseTo(4.589, 4);
  });

  it("M31's bulge packs as a Sérsic instance on the bulge sphere at M31's centre", () => {
    expect(sersic.axes.slice(3, 6)).toEqual(
      new Float32Array([9974.8, 9974.8, 9974.8]),
    );
    expect(sersic.sersic[4]).toBeCloseTo(24.0568, 3);
    expect(sersic.sersic[5]).toBeCloseTo(1 / 2.2, 6);
    expect(sersic.uMax[1]).toBeCloseTo(9.9748, 3);
    expect(sersic.centerAbs.slice(3, 6)).toEqual(new Float32Array([300_000, 500_000, 400_000]));
  });

  it('disc mesh axes are (rEnv, rEnv, zEnv)', () => {
    expect(disc.axes.slice(0, 3)).toEqual(new Float32Array([6000, 6000, 4000 / 3]));
    expect(disc.disc[0]).toBeCloseTo(LMC_EMISSION.density0, 7);
    expect(disc.disc[1]).toBeCloseTo(1 / 1500, 9);
    expect(disc.disc[3]).toBeCloseTo(M31_EMISSION.density0, 7);
  });

  it('applies family default tints and per-object color overrides', () => {
    expect(Array.from(sersic.color.slice(0, 3))).toEqual(
      SPHEROID_COLOR_RGB.map((v) => Math.fround(v)),
    );
    // The bulge component takes the spheroid population tint, not the
    // host disc's.
    expect(Array.from(sersic.color.slice(3, 6))).toEqual(
      SPHEROID_COLOR_RGB.map((v) => Math.fround(v)),
    );
    expect(Array.from(disc.color.slice(0, 3))).toEqual(
      DISC_COLOR_RGB.map((v) => Math.fround(v)),
    );
    const tinted = buildEmissionInstanceData([
      lgObject('X', { ...SMC_EMISSION, color: '#ff8000' }, [0, 0, 1000]),
    ]);
    expect(tinted.sersic.color[0]).toBe(1);
    expect(tinted.sersic.color[1]).toBeCloseTo(128 / 255, 6);
    expect(tinted.sersic.color[2]).toBe(0);
  });
});

describe('cpuRaymarchColumn — the shader mirror', () => {
  it('face-on disc column through the centre matches the closed form', () => {
    // Camera on the +z axis outside the mesh, looking through the
    // centre: ∫ρ ds = 2·ρ₀·z_d·(1 − e^(−zEnv/zd)), independent of the
    // radial profile.
    const c = LMC_DISC;
    const camWorldZ = 40_000;
    const camLocal: [number, number, number] = [0, 0, camWorldZ / c.axesPc[2]];
    const fragLocal: [number, number, number] = [0, 0, -1];
    const worldPerT = camWorldZ + c.axesPc[2];
    const analytic = 2 * c.density0 * c.zdPc * (1 - Math.exp(-c.axesPc[2] / c.zdPc));
    const marched = cpuRaymarchColumn(camLocal, fragLocal, worldPerT, c);
    expect(Math.abs(marched - analytic) / analytic).toBeLessThan(0.02);
  });

  it('camera inside the volume integrates the remaining half column', () => {
    const c = LMC_DISC;
    // Camera at the centre looking down −z: half the face-on column.
    const marched = cpuRaymarchColumn([0, 0, 0], [0, 0, -1], c.axesPc[2], c);
    const analytic = c.density0 * c.zdPc * (1 - Math.exp(-c.axesPc[2] / c.zdPc));
    expect(Math.abs(marched - analytic) / analytic).toBeLessThan(0.02);
  });

  it('spheroid column agrees with a fine-step reference through the same density', () => {
    const c = SMC_SPHEROID;
    const camLocal: [number, number, number] = [0.3, 3, 0.2];
    const fragLocal: [number, number, number] = [
      -0.3 / Math.sqrt(0.18 + 1), -1 / Math.sqrt(1.18) /* ≈ unit */, -0.2 / Math.sqrt(1.18),
    ];
    // Normalise fragLocal onto the unit sphere along the cam→origin-ish ray.
    const len = Math.hypot(...fragLocal);
    const frag: [number, number, number] = [fragLocal[0] / len, fragLocal[1] / len, fragLocal[2] / len];
    const worldPerT = 20_000;
    const marched = cpuRaymarchColumn(camLocal, frag, worldPerT, c);

    // Brute-force reference: 200k linear steps over the same segment.
    const dir = [frag[0] - camLocal[0], frag[1] - camLocal[1], frag[2] - camLocal[2]];
    const N = 200_000;
    let ref = 0;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const p: [number, number, number] = [
        camLocal[0] + t * dir[0],
        camLocal[1] + t * dir[1],
        camLocal[2] + t * dir[2],
      ];
      if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > 1) continue;
      ref += cpuDensityAt(p, c) * (worldPerT / N);
    }
    expect(ref).toBeGreaterThan(0);
    expect(Math.abs(marched - ref) / ref).toBeLessThan(0.05);
  });

  it('returns 0 when the entry point sits at or past the fragment (near-face ray)', () => {
    expect(cpuRaymarchColumn([0, 0, 5], [0, 0, 1], 1000, SMC_SPHEROID)).toBe(0);
  });

  it('bulge component density follows the deprojected Sérsic profile on its own sphere', () => {
    const b = emissionComponents(M31_EMISSION)[1] as SersicComponent;
    const u = 2;
    const p: [number, number, number] = [u / b.uMax, 0, 0];
    expect(cpuDensityAt(p, b)).toBeCloseTo(
      b.density0 * cpuSersicNu(u, b.invN, b.bn, b.pn),
      9,
    );
    // The host disc component carries no bulge term.
    const d = emissionComponents(M31_EMISSION)[0] as DiscComponent;
    const R = u * 1000;
    expect(cpuDensityAt([R / d.axesPc[0], 0, 0], d)).toBeCloseTo(
      d.density0 * Math.exp(-R / d.rdPc),
      9,
    );
  });
});

describe('magFromIntensity / intensityFromMag', () => {
  it('round-trips through the gate convention', () => {
    expect(intensityFromMag(magFromIntensity(1234.5, 15), 15)).toBeCloseTo(1234.5, 6);
    expect(magFromIntensity(1, 15)).toBe(15);
  });
});

describe('LocalGroupEmission controller', () => {
  const objects = [
    lgObject('SMC', SMC_EMISSION, [10_000, 0, -60_000]),
    lgObject('LMC', LMC_EMISSION, [15_000, 5_000, -42_000]),
    lgObject('M31', M31_EMISSION, [300_000, 500_000, 400_000]),
  ];
  const shared = { uMaxAppMag: { value: 6.5 }, uSizeSpan: { value: 5 } };

  const sersicMeshOf = (layer: LocalGroupEmission) =>
    layer.group.children.find((m) =>
      ((m as THREE.Mesh).geometry as THREE.InstancedBufferGeometry).hasAttribute('aSersic'),
    ) as THREE.Mesh;

  it('builds one instanced mesh per family with the packed component counts', () => {
    const layer = new LocalGroupEmission(objects, shared);
    expect(layer.group.children).toHaveLength(2);
    const geoms = layer.group.children.map(
      (m) => (m as THREE.Mesh).geometry as THREE.InstancedBufferGeometry,
    );
    expect(geoms.map((g) => g.instanceCount)).toEqual([2, 2]);
    for (const child of layer.group.children) {
      expect((child as THREE.Mesh).frustumCulled).toBe(false);
      expect(child.renderOrder).toBe(-3);
    }
    layer.dispose();
  });

  it('per-instance attributes are readable back off the geometry', () => {
    const layer = new LocalGroupEmission(objects, shared);
    const geom = sersicMeshOf(layer).geometry as THREE.InstancedBufferGeometry;
    const aSersic = geom.getAttribute('aSersic') as THREE.InstancedBufferAttribute;
    expect(aSersic.getX(0)).toBeCloseTo(SMC_EMISSION.density0, 7);
    const aUMax = geom.getAttribute('aUMax') as THREE.InstancedBufferAttribute;
    expect(aUMax.getX(0)).toBeCloseTo(4.589, 4);
    layer.dispose();
  });

  it('per-family march density rides the material defines', () => {
    const layer = new LocalGroupEmission(objects, shared);
    const sersicMat = sersicMeshOf(layer).material as THREE.ShaderMaterial;
    expect(sersicMat.defines!.EMISSION_STEPS).toBe(EMISSION_STEPS_SERSIC);
    const discMesh = layer.group.children.find((m) => m !== sersicMeshOf(layer)) as THREE.Mesh;
    const discMat = discMesh.material as THREE.ShaderMaterial;
    expect(discMat.defines!.FAMILY_DISC).toBe(1);
    expect(discMat.defines!.EMISSION_STEPS).toBe(EMISSION_STEPS_DISC);
    layer.dispose();
  });

  it('update writes the floating-origin offset uniform', () => {
    const layer = new LocalGroupEmission(objects, shared);
    layer.update(new THREE.Vector3(7, 8, 9));
    const mat = (layer.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.uniforms.uWorldOffset.value.x).toBe(7);
    expect(mat.uniforms.uWorldOffset.value.z).toBe(9);
    layer.dispose();
  });

  it('chart mode and setEnabled both gate visibility; either one hides', () => {
    const layer = new LocalGroupEmission(objects, shared);
    layer.update(new THREE.Vector3());
    expect(layer.group.visible).toBe(true);
    layer.setChartHidden(true);
    expect(layer.group.visible).toBe(false);
    layer.setChartHidden(false);
    expect(layer.group.visible).toBe(true);
    layer.setEnabled(false);
    expect(layer.group.visible).toBe(false);
    layer.dispose();
  });

  it('dispose empties the group and disposes every pass', () => {
    const layer = new LocalGroupEmission(objects, shared);
    const materials = layer.group.children.map((m) => (m as THREE.Mesh).material as THREE.ShaderMaterial);
    const spies = materials.map((m) => {
      let called = false;
      const orig = m.dispose.bind(m);
      m.dispose = () => { called = true; orig(); };
      return () => called;
    });
    layer.dispose();
    expect(layer.group.children).toHaveLength(0);
    for (const wasCalled of spies) expect(wasCalled()).toBe(true);
  });

  it('shares the magnitude uniforms by reference', () => {
    const layer = new LocalGroupEmission(objects, shared);
    const mat = (layer.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.uniforms.uMaxAppMag).toBe(shared.uMaxAppMag);
    shared.uMaxAppMag.value = 9.9;
    expect(mat.uniforms.uMaxAppMag.value).toBe(9.9);
    layer.dispose();
  });
});
