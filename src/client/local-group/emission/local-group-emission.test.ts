import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import type { LgEmission, LgObject } from '../local-group-loader';
import {
  buildEmissionInstanceData,
  cpuDensityAt,
  cpuRaymarchColumn,
  cpuSersicNu,
  emissionComponents,
  emissionStepsFor,
  columnSurfaceBrightness,
  intensityFromMag,
  magFromIntensity,
  subPixelExpansion,
  MIN_PROJECTED_RADIUS_PX,
  DISC_COLOR_RGB,
  DISC_COLOUR_INDEX_BV,
  EMISSION_STEPS_DISC,
  EMISSION_STEPS_SERSIC,
  M31_BULGE_TO_TOTAL_LIGHT,
  M31_TOTAL_COLOUR_INDEX_BV,
  SPHEROID_COLOR_RGB,
  type DiscComponent,
  type SersicComponent,
} from './local-group-emission-pure';
import { LocalGroupEmission } from './local-group-emission';
import { parseOverrides } from '../../../../scripts/local-group/build-local-group';
import { SB_ZERO_POINT, lumaNormalisedTint } from '../../hdr/emission/emission-pure';
import {
  OLD_SPHEROID_COLOR_RGB,
  OLD_SPHEROID_COLOUR_INDEX_BV,
  combinedColourIndex,
} from '../../hdr/emission/population-colour-pure';
import { DEFAULT_SUMMATION_ARCSEC2 } from '../../hdr/exposure/exposure-epoch';
import { bindAttachmentGate } from '../../hdr/attachments/attachment-gate';
import { relativeLuminance } from '../../hdr/tonemap-pure';

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
    type: 'Dwarf spheroidal',
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
      lumaNormalisedTint(SPHEROID_COLOR_RGB).map((v) => Math.fround(v)),
    );
    // The bulge component takes the spheroid population tint, not the
    // host disc's.
    expect(Array.from(sersic.color.slice(3, 6))).toEqual(
      lumaNormalisedTint(SPHEROID_COLOR_RGB).map((v) => Math.fround(v)),
    );
    expect(Array.from(disc.color.slice(0, 3))).toEqual(
      lumaNormalisedTint(DISC_COLOR_RGB).map((v) => Math.fround(v)),
    );
    const tinted = buildEmissionInstanceData([
      lgObject('X', { ...SMC_EMISSION, color: '#ff8000' }, [0, 0, 1000]),
    ]);
    const expected = lumaNormalisedTint([1, 128 / 255, 0]);
    expect(tinted.sersic.color[0]).toBeCloseTo(expected[0], 5);
    expect(tinted.sersic.color[1]).toBeCloseTo(expected[1], 5);
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
  it('round-trips through the zero-point convention', () => {
    expect(intensityFromMag(magFromIntensity(1234.5, 15), 15)).toBeCloseTo(1234.5, 6);
    expect(magFromIntensity(1, 15)).toBe(15);
  });
});

describe('surface-brightness zero point', () => {
  // A column is flux per steradian, so the zero point is the magnitude of
  // one arcsec² of solid angle. Derived, never tuned.
  it('is the solid angle of one arcsec²', () => {
    expect(SB_ZERO_POINT).toBeCloseTo(26.5721256659, 9);
  });

  // Nothing at compile time ties the shader's copy to this one.
  it('the fragment shader declares the same value', () => {
    const frag = readFileSync(
      fileURLToPath(new URL('./local-group-emission.frag.glsl', import.meta.url)),
      'utf8',
    );
    const m = frag.match(/const float SB_ZERO_POINT = ([\d.]+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(SB_ZERO_POINT, 9);
  });

  it('the resolution floor matches the one the vertex shader applies', () => {
    const vert = readFileSync(
      fileURLToPath(new URL('./local-group-emission.vert.glsl', import.meta.url)),
      'utf8',
    );
    const m = vert.match(/const float MIN_PROJECTED_RADIUS_PX = ([\d.]+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(MIN_PROJECTED_RADIUS_PX);
  });

  it('a unit column reads at the zero point', () => {
    expect(columnSurfaceBrightness(1)).toBeCloseTo(SB_ZERO_POINT, 12);
  });

  // The band's own summation anchor, which this layer used to opt out of by
  // passing Ω_px twice. It can take it now only because the anchor rides
  // attachment 2 and the resolve averages over the patch first
  // (../hdr/summation/README.md) — so the `location = 2` declaration and the
  // summation uniform are one contract. A shader that gained by Ω_sum
  // straight into attachment 0 would put 3.95 mag on M31's nucleus.
  it('displays at the summation area, through the diffuse attachment', () => {
    const frag = readFileSync(
      fileURLToPath(new URL('./local-group-emission.frag.glsl', import.meta.url)),
      'utf8',
    );
    expect(frag).toMatch(
      /uExposure, SB_ZERO_POINT, uOmegaSummationArcsec2, uOmegaPxArcsec2,/,
    );
    expect(frag).toMatch(/layout\(location = 2\) out vec4 outDiffuse;/);
  });

  // Both volumetric emitters have to reach attachment 2 and neither may
  // reach attachment 0 on-target, so the gate they mark themselves with is
  // part of the contract: `markStatisticEmitter` would discard every diffuse
  // write silently rather than fail.
  it('marks itself a diffuse emitter, not merely a physical one', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./local-group-emission.ts', import.meta.url)),
      'utf8',
    );
    expect(src).toContain('markDiffuseEmitter(mesh)');
    expect(src).not.toContain('markStatisticEmitter');
  });
});

describe('population tints', () => {
  it('both family tints carry unit relative luminance', () => {
    for (const rgb of [SPHEROID_COLOR_RGB, DISC_COLOR_RGB]) {
      expect(relativeLuminance(lumaNormalisedTint(rgb))).toBeCloseTo(1, 12);
    }
  });

  // Peak-normalised chromaticities, so neither authored triplet has unit
  // luminance and both would dim their own family without the
  // normalisation. The spheroid's own loss is the shared population
  // constant's, pinned in ../../hdr/emission/population-colour-pure.test.ts;
  // what this layer owns is its disc seed and the ordering between them.
  it('pins what the disc tint would cost unnormalised', () => {
    const lost = (rgb: readonly [number, number, number]) =>
      -2.5 * Math.log10(relativeLuminance(rgb));
    expect(lost(DISC_COLOR_RGB)).toBeCloseTo(0.1769, 4);
    expect(lost(DISC_COLOR_RGB)).toBeLessThan(lost(SPHEROID_COLOR_RGB));
  });

  // One population, one triplet: the spheroid seed is not this layer's to
  // derive, and the band's bulge reads the same constant.
  it('takes the spheroid seed from the shared population constant', () => {
    expect(SPHEROID_COLOR_RGB).toBe(OLD_SPHEROID_COLOR_RGB);
  });

  // The seeds are colour indices now, not hues picked to look right.
  it('derives the disc index from M31 rather than the Milky Way', () => {
    expect(DISC_COLOUR_INDEX_BV).toBeCloseTo(0.8189, 4);
    expect(DISC_COLOUR_INDEX_BV).toBeLessThan(OLD_SPHEROID_COLOUR_INDEX_BV);
  });

  // The solve is only honest while it splits the light the same way the
  // flux solve does, and that split lives in the build's input table.
  it('solves against the B/T the emission solver actually uses', () => {
    const row = parseOverrides(
      readFileSync(
        fileURLToPath(
          new URL('../../../../data/local-group/overrides.tsv', import.meta.url),
        ),
        'utf-8',
      ),
    ).find((o) => o.name === 'M31');
    expect(row?.bulgeToTotal).toBe(M31_BULGE_TO_TOTAL_LIGHT);
  });

  // Recombining the two seeds at M31's B/T has to return the published
  // integrated colour — that is the constraint the solve preserves, and
  // the reason the disc index is not synthesised independently.
  it('recombines to Tempel 2011 (B−V)₀ for M31', () => {
    expect(
      combinedColourIndex(
        OLD_SPHEROID_COLOUR_INDEX_BV,
        DISC_COLOUR_INDEX_BV,
        M31_BULGE_TO_TOTAL_LIGHT,
      ),
    ).toBeCloseTo(M31_TOTAL_COLOUR_INDEX_BV, 12);
  });
});

describe('subPixelExpansion', () => {
  it('is inert at and above the resolution floor', () => {
    expect(subPixelExpansion(MIN_PROJECTED_RADIUS_PX)).toBe(1);
    expect(subPixelExpansion(50)).toBe(1);
  });

  it('lifts a sub-pixel mesh exactly to the floor', () => {
    expect(subPixelExpansion(0.25) * 0.25).toBeCloseTo(MIN_PROJECTED_RADIUS_PX, 12);
    expect(subPixelExpansion(0.001)).toBe(1000);
  });

  it('is continuous across the floor — no cutover to hysteresis against', () => {
    const below = subPixelExpansion(MIN_PROJECTED_RADIUS_PX - 1e-9);
    expect(below).toBeCloseTo(1, 8);
  });

  it('the axes×k, scale-lengths×k, density÷k³ triple conserves flux exactly', () => {
    // Column ∝ ρ·path = k⁻³·k = k⁻², solid angle ∝ k², so Φ is invariant.
    const k = subPixelExpansion(0.1);
    const columnFactor = (1 / k ** 3) * k;
    const solidAngleFactor = k ** 2;
    expect(columnFactor * solidAngleFactor).toBeCloseTo(1, 12);
  });

  it('degrades to inert on a degenerate projected radius', () => {
    expect(subPixelExpansion(0)).toBe(1);
    expect(subPixelExpansion(Number.NaN)).toBe(1);
  });
});

describe('LocalGroupEmission controller', () => {
  const objects = [
    lgObject('SMC', SMC_EMISSION, [10_000, 0, -60_000]),
    lgObject('LMC', LMC_EMISSION, [15_000, 5_000, -42_000]),
    lgObject('M31', M31_EMISSION, [300_000, 500_000, 400_000]),
  ];
  const makeDeps = () => ({
    hdr: {
      uExposure: { value: 26.365 },
      uOmegaPxArcsec2: { value: 40_000 },
      uOmegaSummationArcsec2: { value: DEFAULT_SUMMATION_ARCSEC2 },
      uWhitePoint: { value: 20 },
      uHighlightDesat: { value: 0.35 },
      uHdrTarget: { value: 1 },
    },
  });
  const deps = makeDeps();

  const sersicMeshOf = (layer: LocalGroupEmission) =>
    layer.group.children.find((m) =>
      ((m as THREE.Mesh).geometry as THREE.InstancedBufferGeometry).hasAttribute('aSersic'),
    ) as THREE.Mesh;

  it('builds one instanced mesh per family with the packed component counts', () => {
    const layer = new LocalGroupEmission(objects, deps);
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
    const layer = new LocalGroupEmission(objects, deps);
    const geom = sersicMeshOf(layer).geometry as THREE.InstancedBufferGeometry;
    const aSersic = geom.getAttribute('aSersic') as THREE.InstancedBufferAttribute;
    expect(aSersic.getX(0)).toBeCloseTo(SMC_EMISSION.density0, 7);
    const aUMax = geom.getAttribute('aUMax') as THREE.InstancedBufferAttribute;
    expect(aUMax.getX(0)).toBeCloseTo(4.589, 4);
    layer.dispose();
  });

  it('per-family march density rides the material defines', () => {
    const layer = new LocalGroupEmission(objects, deps);
    const sersicMat = sersicMeshOf(layer).material as THREE.ShaderMaterial;
    expect(sersicMat.defines!.EMISSION_STEPS).toBe(EMISSION_STEPS_SERSIC);
    const discMesh = layer.group.children.find((m) => m !== sersicMeshOf(layer)) as THREE.Mesh;
    const discMat = discMesh.material as THREE.ShaderMaterial;
    expect(discMat.defines!.FAMILY_DISC).toBe(1);
    expect(discMat.defines!.EMISSION_STEPS).toBe(EMISSION_STEPS_DISC);
    layer.dispose();
  });

  it('update writes the floating-origin offset uniform', () => {
    const layer = new LocalGroupEmission(objects, deps);
    layer.update(new THREE.Vector3(7, 8, 9));
    const mat = (layer.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.uniforms.uWorldOffset.value.x).toBe(7);
    expect(mat.uniforms.uWorldOffset.value.z).toBe(9);
    layer.dispose();
  });

  it('chart mode and setEnabled both gate visibility; either one hides', () => {
    const layer = new LocalGroupEmission(objects, deps);
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
    const layer = new LocalGroupEmission(objects, deps);
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

  it('binds the HDR emitter uniforms by reference on every pass', () => {
    const d = makeDeps();
    const layer = new LocalGroupEmission(objects, d);
    for (const child of layer.group.children) {
      const mat = (child as THREE.Mesh).material as THREE.ShaderMaterial;
      expect(mat.uniforms.uExposure).toBe(d.hdr.uExposure);
      expect(mat.uniforms.uOmegaPxArcsec2).toBe(d.hdr.uOmegaPxArcsec2);
      expect(mat.uniforms.uHdrTarget).toBe(d.hdr.uHdrTarget);
    }
    d.hdr.uExposure.value = 99;
    const mat = (layer.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.uniforms.uExposure.value).toBe(99);
    layer.dispose();
  });

  it('reads no star-pipeline gate uniform — the exposure model is the only lever', () => {
    const layer = new LocalGroupEmission(objects, deps);
    for (const child of layer.group.children) {
      const names = Object.keys(
        ((child as THREE.Mesh).material as THREE.ShaderMaterial).uniforms,
      );
      expect(names).not.toContain('uLimitMag');
      expect(names).not.toContain('uSizeSpan');
      expect(names).not.toContain('uBrightnessScale');
      expect(names).not.toContain('uGlowMagOffset');
    }
    layer.dispose();
  });

  it('marks every pass a physical emitter so it reaches the statistic attachment', () => {
    const layer = new LocalGroupEmission(objects, deps);
    let opened = 0;
    bindAttachmentGate(() => { opened += 1; }, () => {});
    for (const child of layer.group.children) {
      child.onBeforeRender(
        null as never, null as never, null as never,
        null as never, null as never, null as never,
      );
    }
    bindAttachmentGate(null, null);
    expect(opened).toBe(layer.group.children.length);
    layer.dispose();
  });
});
