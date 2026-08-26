// atmosphere-scatter.glsl duplicates constants and expression shapes from
// atmosphere-scattering-pure.ts with nothing at compile time tying the two
// sides together. No GL context in vitest, so pin the source text.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LUMA_WEIGHTS } from '../../hdr/tonemap/tonemap-pure';
import {
  MS_STRENGTH,
  TWILIGHT_TAIL_AMP,
  TWILIGHT_TAIL_REACH,
} from './atmosphere-scattering-pure';

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
  it('multiple-scattering fill weight, as 1/(4π) on both sides', () => {
    // A rounded literal here would be a second, drifting statement of a
    // derived quantity the file already declares exactly.
    expect(scatter).toContain('const float STELLATA_INV_4PI = 1.0 / (4.0 * PI);');
    expect(scatter).toContain('const float STELLATA_MS_STRENGTH = STELLATA_INV_4PI;');
    expect(MS_STRENGTH).toBe(1 / (4 * Math.PI));
  });

  it('Rec.709 luma weights', () => {
    // Its own const because the hdr chunks spliced alongside declare theirs;
    // same numbers, and this is what keeps them the same numbers.
    const [r, g, b] = LUMA_WEIGHTS;
    expect(scatter).toContain(`const vec3 STELLATA_LUMA = vec3(${r}, ${g}, ${b});`);
  });

  it('twilight tail amplitude and reach', () => {
    expect(glslFloat(scatter, 'STELLATA_TWILIGHT_TAIL_AMP')).toBe(TWILIGHT_TAIL_AMP);
    expect(glslFloat(scatter, 'STELLATA_TWILIGHT_TAIL_REACH')).toBe(TWILIGHT_TAIL_REACH);
  });

  it('takes its ray-start jitter from the shared chunk, not a local hash', () => {
    // One hash across the tree — the chunk carries the constants and
    // ../../hdr/emission/chunk-constant-drift.test.ts pins them there. A
    // second copy here is how the GLSL and TSL marches start sampling
    // different lattices.
    expect(scatter).toContain('#include <stellata_ign>');
    expect(scatter).not.toMatch(/float stellata_atmoJitter/);
    expect(scatter).not.toContain('52.9829189');
    expect(scatter).not.toContain('0.06711056');
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
    // jitter-patterned sunlight on the anti-solar face. The CPU mirror's
    // float32 simulation is the load-bearing pin (vitest has no GL); this side
    // only has the source text, so assert the whole function body at once —
    // t may appear ONLY as a subtrahend, never summed with h.
    const body = scatter.match(
      /float stellata_litFraction\(float t, float h, float s0, float s1\) \{([^}]*)\}/,
    );
    expect(body).not.toBeNull();
    const normalised = body![1].replace(/\s+/g, '');
    expect(normalised).toBe(
      'floatlo=max(s0-t,-h);floathi=min(s1-t,h);return1.0-max(hi-lo,0.0)/(2.0*h);',
    );
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

  it('deflattens the camera and the sun direction in both shaders', () => {
    // Miss the sun direction and the shadow cylinder tilts against the body it
    // is cast by; miss the camera and the unit-sphere geometry describes a body
    // that is not the one drawn. Both go through the shared helpers so neither
    // frag can drift from the other.
    for (const src of [shell, meshFrag]) {
      expect(src).toMatch(
        /stellata_deflattenedCamera\(uCenterView, uRadiusPc, uPoleView, uPolarRadiusR\)/);
      expect(src).toMatch(
        /stellata_deflattenedDir\(uSunDirView, uPoleView, uPolarRadiusR\)/);
      // The arithmetic these replaced, open-coded at either call site.
      expect(src).not.toMatch(/1\.0\s*\/\s*uPolarRadiusR/);
    }
  });

  it('reads the mesh fragment’s surface point off the SQUASHED normal', () => {
    // uRadiusPc·normal is a point on the equatorial-radius SPHERE, up to f·R
    // outside the spheroid fragment being shaded — at the limb that collapsed
    // the airlight chord and left a dark seam against the halo. Squashing by
    // uPolarRadiusR (not its reciprocal) is the inverse-transpose direction.
    expect(meshFrag).toMatch(
      /vec3 surf = normalize\(stellata_scalePolar\(normalize\(vNormalV\), uPoleView, uPolarRadiusR\)\);/);
    expect(meshFrag).not.toContain('uCenterView + uRadiusPc * nrm');
  });

  it('keeps the skylight term on the REAL-space sun cosine', () => {
    // Solar depression is measured against the true local horizontal, so the
    // skylight term must not be handed the deflattened sun direction.
    expect(meshFrag).toContain('stellata_skyIrradiance(sunCos, uScaleHeightR,');
    expect(meshFrag).toContain('float sunCos = dot(n, uSunDirView);');
  });
});

describe('skylight on the surface', () => {
  it('hangs the twilight falloff on the shadow-edge altitude over the scale height', () => {
    expect(scatter).toContain(
      'return 1.0 / sqrt(max(1.0 - sunCos * sunCos, 1e-12)) - 1.0;');
    expect(scatter).toContain('float tail = exp(-h / hR)');
    expect(scatter).toContain(
      '+ STELLATA_TWILIGHT_TAIL_AMP * exp(-h / (STELLATA_TWILIGHT_TAIL_REACH * hR));');
  });

  it('derives the terminator anchor from the Chapman column, not a fixed fraction', () => {
    expect(scatter).toContain('float ch = sqrt(PI / (2.0 * hR));');
    expect(scatter).toContain('vec3 tBar = (1.0 - exp(-x)) / x;');
    expect(scatter).toContain('vec3 fTerm = 0.25 * tauScatter * tBar * exp(-tauAbsorb);');
    expect(scatter).not.toMatch(/TWILIGHT_SCATTER_FRAC/);
  });

  it('gives the lit side a beam-interception term that vanishes at the terminator', () => {
    expect(scatter).toContain('float mu = max(sunCos, 0.0);');
    expect(scatter).toContain('vec3 beam = (0.5 * mu) * (tauScatter / tauExt)');
  });

  it('partitions the anchor against the beam term instead of summing them', () => {
    // Both describe the same photons at opposite solar elevations, so carrying
    // the horizon-sun anchor to noon double-counts it — README.md § Skylight.
    expect(scatter).toContain('return fTerm * (tail * (1.0 - mu)) + beam;');
  });

  it('rides the surface scalar, added to the direct term rather than the airlight', () => {
    // It is light reflected off the ground, so it needs the albedo-bearing
    // scalar; folding it into the airlight would skip the surface entirely.
    expect(meshFrag).toMatch(/vec3 surfaceScale = base \* uSurfaceLuminance \* shadow;/);
    expect(meshFrag).toMatch(/col \+= surfaceScale \* stellata_skyIrradiance\(/);
    // uAirlightLuminance scales the march and nothing else.
    expect(meshFrag.match(/uAirlightLuminance/g)).toHaveLength(2); // declaration + use
  });

  it('splits scattering from absorption — one redirects light, the other removes it', () => {
    expect(scatter).toContain('return betaRs * hR + vec3(betaMs * hM);');
    expect(meshFrag).toContain(
      'stellata_verticalScatterTau(uBetaRayleigh, uBetaMie, uScaleHeightR, uScaleHeightM)');
    expect(meshFrag).toContain('uBetaAbsorb * uScaleHeightM');
  });
});
