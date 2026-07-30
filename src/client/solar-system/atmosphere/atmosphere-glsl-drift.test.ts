// atmosphere-scatter.glsl duplicates constants and expression shapes from
// atmosphere-scattering-pure.ts with nothing at compile time tying the two
// sides together. No GL context in vitest, so pin the source text.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MS_STRENGTH, TWILIGHT_SCATTER_FRAC } from './atmosphere-scattering-pure';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const scatter = read('./atmosphere-scatter.glsl');
const meshFrag = read('../planets/planet-mesh.frag.glsl');

function glslFloat(src: string, name: string): number {
  const m = src.match(new RegExp(`const float ${name} = ([-\\d.e]+);`));
  if (m === null) throw new Error(`${name} not declared`);
  return Number(m[1]);
}

describe('constants mirrored from the CPU model', () => {
  it('multiple-scattering fill weight', () => {
    expect(glslFloat(scatter, 'STELLATA_MS_STRENGTH')).toBe(MS_STRENGTH);
  });

  it('twilight scatter fraction', () => {
    expect(glslFloat(scatter, 'STELLATA_TWILIGHT_SCATTER_FRAC'))
      .toBe(TWILIGHT_SCATTER_FRAC);
  });
});

describe('the airlight has no gain', () => {
  it('accumulates the multiple-scattering fill without scaling single scatter', () => {
    // The integrator's output is already a fraction of host irradiance, and
    // uAirlightLuminance carries that irradiance, so any surviving scalar
    // here is a display fudge on a physical quantity.
    expect(scatter).toContain('inscatter += ms;');
    expect(scatter).not.toMatch(/AIRLIGHT_GAIN/);
  });
});

describe('the shadow is solved along the ray, not sampled across it', () => {
  it('cuts the cylinder quadratic against the terminator half-space', () => {
    expect(scatter).toContain('float disc = b * b - a * c;');
    expect(scatter).toContain('if (dS > 0.0) hi = min(hi, th); else lo = max(lo, th);');
  });

  it('keeps the sunward-of-the-terminator escape, which the cylinder alone misses', () => {
    // Points inside the cylinder by impact parameter but in FRONT of the body
    // are lit; dropping this branch shadows the whole day side.
    expect(scatter).toContain('} else if (oS >= 0.0) {');
  });

  it('holds the parallel-ray case, where the impact parameter never changes', () => {
    expect(scatter).toContain('if (c >= 0.0) return;');
    expect(scatter).toContain('lo = -STELLATA_SHADOW_FAR;');
  });

  it('weights each sample by its segment’s coverage, at half the march step', () => {
    expect(scatter).toContain(
      'float lit = stellata_litFraction(t, 0.5 * segLen, shadow0, shadow1);');
  });

  it('clamps the coverage bounds to the segment BEFORE differencing them', () => {
    // t is the ray parameter from the camera, so t ± h are large and nearly
    // equal and 1/(2h) amplifies what float32 loses between them. Taking both
    // bounds as offsets from t is what keeps deep shadow exactly 0 instead of
    // jitter-patterned sunlight on the anti-solar face.
    expect(scatter).toContain('float lo = max(s0 - t, -h);');
    expect(scatter).toContain('float hi = min(s1 - t, h);');
    expect(scatter).toContain('return 1.0 - max(hi - lo, 0.0) / (2.0 * h);');
    expect(scatter).not.toContain('min(t + h');
  });

  it('leaves the empty span inverted and unbounded, not [1, 0]', () => {
    // A [1, 0] sentinel only reads as empty for ray parameters outside it.
    expect(scatter).toContain('s0 = STELLATA_SHADOW_FAR;');
    expect(scatter).toContain('s1 = -STELLATA_SHADOW_FAR;');
  });

  it('solves the span once per ray, outside the march', () => {
    // Inside the loop it would still be exact, just ATMO_N_VIEW× the cost.
    const spanCall = scatter.indexOf('stellata_shadowSpan(o, d, sunDir, shadow0, shadow1);');
    const loop = scatter.indexOf('for (int i = 0; i < ATMO_N_VIEW; i++)');
    expect(spanCall).toBeGreaterThan(0);
    expect(spanCall).toBeLessThan(loop);
  });

  it('carries no fixed shadow-softness constant any more', () => {
    expect(scatter).not.toMatch(/SHADOW_SOFT[^_]/);
  });
});

describe('the march runs in the frame where the oblate body is a unit sphere', () => {
  const shell = read('./planet-atmosphere.frag.glsl');

  it('scales only the polar component, and inverts by scaling back', () => {
    expect(scatter).toContain('return v + pole * (dot(v, pole) * (s - 1.0));');
  });

  it('deflattens the ray and the sun direction in both shaders', () => {
    // Miss the sun direction and the shadow cylinder tilts against the body it
    // is cast by; miss either ray term and the unit-sphere geometry describes a
    // body that is not the one drawn.
    for (const src of [shell, meshFrag]) {
      expect(src).toContain('float invPolar = 1.0 / uPolarRadiusR;');
      expect(src).toContain(
        'stellata_scalePolar(-uCenterView / uRadiusPc, uPoleView, invPolar)');
      expect(src).toContain(
        'normalize(stellata_scalePolar(uSunDirView, uPoleView, invPolar))');
    }
  });

  it('reads the mesh fragment’s surface point off the SQUASHED normal', () => {
    // uRadiusPc·normal is a point on the equatorial-radius SPHERE, up to f·R
    // outside the spheroid fragment being shaded — at the limb that collapsed
    // the airlight chord and left a dark seam against the halo.
    expect(meshFrag).toContain(
      'vec3 surf = normalize(stellata_scalePolar(nrm, uPoleView, uPolarRadiusR));');
    expect(meshFrag).not.toContain('uCenterView + uRadiusPc * nrm');
  });

  it('keeps the twilight term on the REAL-space sun cosine', () => {
    // Solar depression is measured against the true local horizontal, so the
    // twilight term must not be handed the deflattened sun direction.
    expect(meshFrag).toContain('stellata_twilightIrradiance(sunCos, uScaleHeightR,');
    expect(meshFrag).toContain('float sunCos = dot(n, uSunDirView);');
  });
});

describe('twilight on the night-side surface', () => {
  it('is the shadow-edge altitude over the scale height', () => {
    expect(scatter).toContain(
      'return 1.0 / sqrt(max(1.0 - sunCos * sunCos, 1e-12)) - 1.0;');
    expect(scatter).toContain(
      'exp(-stellata_shadowEdgeAltitude(sunCos) / hR)');
  });

  it('rides the surface scalar, added to the direct term rather than the airlight', () => {
    // It is light reflected off the ground, so it needs the albedo-bearing
    // scalar; folding it into the airlight would skip the surface entirely.
    expect(meshFrag).toContain(
      'vec3 col = base * (dayside * limb * uPhaseScale + twilight) * uSurfaceLuminance * shadow;');
  });

  it('takes the scattering optical depth only — absorption removes light', () => {
    expect(scatter).toContain('return betaRs * hR + vec3(betaMs * hM);');
    expect(meshFrag).toContain(
      'stellata_verticalScatterTau(uBetaRayleigh, uBetaMie, uScaleHeightR, uScaleHeightM)');
  });
});
