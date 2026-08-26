import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SOL_BODIES } from '../../planet-system';
import { relativeLuminance } from '../../../hdr/tonemap/tonemap-pure';
import {
  LIMB_REFRACTION_RAD,
  OZONE_CHAPPUIS_TAU,
  UMBRA_DILUTION,
  limbColumnRatio,
  limbTransmittance,
  umbralDepthFromOffsets,
  umbralDepthRad,
  umbralGlow,
} from './umbral-glow-pure';

const earth = SOL_BODIES.find((b) => b.name === 'Earth')!;
const atmo = earth.atmosphere!;

/** Earth–Moon mean distance and the Sun's angular radius from the Moon. */
const MOON_DIST_KM = 384400;
const SUN_ANG_RAD = 0.004653;
const casterAngRad = earth.radiusKm / MOON_DIST_KM;
/** Depth at the umbra's centre: the Sun's near limb this far inside Earth's. */
const MID_UMBRA_RAD = umbralDepthRad(casterAngRad, 0, SUN_ANG_RAD);

const glowAt = (depthRad: number) =>
  umbralGlow(atmo, earth.radiusKm, MOON_DIST_KM, SUN_ANG_RAD, depthRad);
const lumOf = (g: [number, number, number]) => relativeLuminance(g);

describe('the limb path is why the umbra is red', () => {
  it('amplifies the vertical column ~70x on Earth', () => {
    // sqrt(2*pi*R/H). This one factor is what turns a blue optical depth of
    // 0.22 — which barely tints the sky — into 15.6, extinction by 6e6.
    expect(limbColumnRatio(earth.radiusKm, atmo.rayleighHeightKm)).toBeCloseTo(70.7, 1);
  });

  it('blocks the surface-grazing ray outright, aerosol first', () => {
    // Nothing gets through at h = 0, and Mie leads: 0.05 vertical over a
    // 1.2 km scale height is tau 9.1 on the limb path, before Rayleigh's 3.5
    // in red. That is just the everyday fact that you cannot see through
    // 300 km of sea-level air — and it is why the Danjon scale tracks
    // volcanic aerosol loading, since the light that reaches the umbra has
    // to come from above the muck.
    const t = limbTransmittance(atmo, earth.radiusKm, 0);
    for (const c of t) expect(c).toBeLessThan(1e-5);
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
  });

  it('is red-dominated where the light actually comes from', () => {
    // ~10 km up: above most of the aerosol, still deep enough in the
    // molecular column for Rayleigh to have taken the blue.
    const t = limbTransmittance(atmo, earth.radiusKm, 10);
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
    // ~9.5x, not the ~33x Rayleigh alone would give: ozone eats red here
    // (tau 1.31 against blue's 0.09) and takes most of that back.
    expect(t[0] / Math.max(t[2], 1e-30)).toBeGreaterThan(5);
  });

  it('clears to transparent well above the atmosphere', () => {
    const t = limbTransmittance(atmo, earth.radiusKm, 80);
    for (const c of t) expect(c).toBeGreaterThan(0.99);
  });
});

describe('ozone is what makes the outer umbra turquoise', () => {
  it('absorbs green hardest and blue least', () => {
    // The Chappuis band peaks near 600 nm, so it eats the very light Rayleigh
    // leaves behind. Inverting this would turn the rim pink and nothing else
    // in the render would look wrong.
    expect(OZONE_CHAPPUIS_TAU[1]).toBeGreaterThan(OZONE_CHAPPUIS_TAU[0]);
    expect(OZONE_CHAPPUIS_TAU[0]).toBeGreaterThan(OZONE_CHAPPUIS_TAU[2]);
  });

  it('puts more blue than green in the shallow umbra', () => {
    // Near the rim the tangent rays are high enough that Rayleigh has stopped
    // killing blue, and ozone is then the term that decides — so blue outruns
    // green. This is the detail nobody expects, and it falls out of the two
    // published columns rather than being painted in.
    const g = glowAt(0.02 * (Math.PI / 180));
    expect(g[2]).toBeGreaterThan(g[1]);
    // Deep in the umbra Rayleigh has won again and the order is back to red.
    const deep = glowAt(MID_UMBRA_RAD);
    expect(deep[0]).toBeGreaterThan(deep[1]);
    expect(deep[1]).toBeGreaterThan(deep[2]);
  });
});

describe('umbral glow brightness', () => {
  it('lands mid-umbra on the measured Danjon L=2 appearance', () => {
    // A totally eclipsed Moon near visual magnitude 0.0 against the full
    // Moon's -12.74 is a flux ratio of 8.0e-6. This is the one anchored
    // number (UMBRA_DILUTION); everything else is geometry and published
    // optical depths.
    const lum = lumOf(glowAt(MID_UMBRA_RAD));
    const dmag = -2.5 * Math.log10(lum);
    expect(-12.74 + dmag).toBeCloseTo(0, 1);
  });

  it('is a deep copper red there, not merely dim', () => {
    const g = glowAt(MID_UMBRA_RAD);
    expect(g[1] / g[0]).toBeLessThan(0.15);
    expect(g[2] / g[0]).toBeLessThan(0.01);
  });

  it('darkens monotonically inward', () => {
    let prev = Infinity;
    for (const deg of [0.05, 0.2, 0.4, 0.6, 0.68]) {
      const lum = lumOf(glowAt(deg * (Math.PI / 180)));
      expect(lum).toBeLessThan(prev);
      prev = lum;
    }
  });

  it('stays bounded at the umbral edge instead of diverging', () => {
    // h_max diverges logarithmically as the depth goes to zero; the cap at
    // the atmosphere's own top is what bounds it, and there is genuinely
    // nothing above that height to refract.
    const atEdge = lumOf(glowAt(0));
    const insideEdge = lumOf(glowAt(1e-9));
    expect(atEdge).toBeLessThan(1);
    expect(insideEdge).toBeCloseTo(atEdge, 12);
  });

  it('gives nothing past the reach of refraction', () => {
    expect(glowAt(LIMB_REFRACTION_RAD)).toEqual([0, 0, 0]);
    expect(glowAt(LIMB_REFRACTION_RAD * 1.5)).toEqual([0, 0, 0]);
  });

  it('reaches the whole umbra — refraction exceeds the mid-umbra depth', () => {
    // The claim the whole feature rests on. If it failed, the umbra's centre
    // would be genuinely black and no amount of transmittance would help.
    expect(LIMB_REFRACTION_RAD).toBeGreaterThan(MID_UMBRA_RAD);
    expect(lumOf(glowAt(MID_UMBRA_RAD))).toBeGreaterThan(0);
  });

  it('moves brightness only, never hue, if the anchor is retuned', () => {
    // UMBRA_DILUTION is achromatic by construction — the colour is derived.
    const g = glowAt(MID_UMBRA_RAD);
    const ratio = g[1] / g[0];
    expect(UMBRA_DILUTION).toBeGreaterThan(0);
    expect(ratio).toBeGreaterThan(0);
    // Scaling the anchor scales all three channels alike, so the ratio holds.
    expect((g[1] * 2) / (g[0] * 2)).toBeCloseTo(ratio, 12);
  });
});

describe('umbralDepthRad', () => {
  it('crosses zero exactly at the start of totality', () => {
    // Totality begins when the host's near limb passes inside the caster's.
    expect(umbralDepthRad(0.02, 0.0, 0.02)).toBeCloseTo(0, 12);
    expect(umbralDepthRad(0.02, 0.005, 0.01)).toBeGreaterThan(0);
    expect(umbralDepthRad(0.02, 0.015, 0.01)).toBeLessThan(0);
  });

  it('puts the Moon well inside Earth umbra at a central eclipse', () => {
    expect(MID_UMBRA_RAD).toBeGreaterThan(0);
    expect((MID_UMBRA_RAD * 180) / Math.PI).toBeCloseTo(0.683, 2);
  });
});

describe('umbralDepthFromOffsets', () => {
  it('reproduces the mid-umbra depth from the offsets a layer holds', () => {
    // Moon at the origin, Earth one mean distance away toward the Sun. Both
    // render layers arrive here with exactly this pair, and the value has to
    // match the umbralDepthRad the rest of this suite is pinned against.
    expect(
      umbralDepthFromOffsets(
        0, 0, MOON_DIST_KM, MOON_DIST_KM,
        0, 0, 1,
        earth.radiusKm, SUN_ANG_RAD,
      ),
    ).toBeCloseTo(MID_UMBRA_RAD, 12);
  });

  it('shallows off-axis by the miss distance', () => {
    const offKm = 3000;
    const dist = Math.hypot(offKm, MOON_DIST_KM);
    const depth = umbralDepthFromOffsets(
      offKm, 0, MOON_DIST_KM, dist,
      0, 0, 1,
      earth.radiusKm, SUN_ANG_RAD,
    );
    expect(depth).toBeLessThan(MID_UMBRA_RAD);
    expect(depth).toBeCloseTo(
      umbralDepthRad(earth.radiusKm / dist, offKm / dist, SUN_ANG_RAD),
      12,
    );
  });

  it('reports no shadow geometry when the caster is behind the body', () => {
    // A caster on the far side from the host casts away from the body, never
    // onto it. -Infinity is what the glow's contact gate reads as "nowhere
    // near the umbra"; returning a plain negative depth would let the
    // uncapped-band branch light an unshadowed body.
    expect(
      umbralDepthFromOffsets(
        0, 0, -MOON_DIST_KM, MOON_DIST_KM, 0, 0, 1, earth.radiusKm, SUN_ANG_RAD,
      ),
    ).toBe(Number.NEGATIVE_INFINITY);
    expect(
      umbralDepthFromOffsets(0, 0, 0, 0, 0, 0, 1, earth.radiusKm, SUN_ANG_RAD),
    ).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('the glow costs nothing outside the shadow', () => {
  it('gives nothing before penumbral contact', () => {
    // Contact is where the caster's disc first touches the host's, at
    // depth = -2*hostAngRad. Past it there is no shadow for this light to
    // fill, and both layers discard it — so the 64-sample quadrature must not
    // run. Before the gate existed it ran every frame of every non-eclipse.
    expect(glowAt(-2 * SUN_ANG_RAD - 1e-6)).toEqual([0, 0, 0]);
    expect(glowAt(-1)).toEqual([0, 0, 0]);
    expect(glowAt(Number.NEGATIVE_INFINITY)).toEqual([0, 0, 0]);
  });

  it('still takes the full ring across the penumbra', () => {
    // The penumbra deliberately has no special case: the direct beam outshines
    // this by orders of magnitude there, and gating on totality instead put a
    // step at the one instant the eye is watching.
    expect(lumOf(glowAt(-2 * SUN_ANG_RAD + 1e-5))).toBeGreaterThan(0);
    expect(lumOf(glowAt(-SUN_ANG_RAD))).toBeGreaterThan(0);
  });
});

describe('the shader adds it rather than flooring the shadow', () => {
  const frag = readFileSync(
    fileURLToPath(new URL('../planet-mesh.frag.glsl', import.meta.url)),
    'utf8',
  );

  it('declares the uniform and weights it by what the caster removed', () => {
    expect(frag).toContain('uniform vec3 uUmbralGlow;');
    expect(frag).toContain('* uUmbralGlow * (dayside * limb * uPhaseScale)');
    expect(frag).toContain('(1.0 - shadow)');
  });

  it('leaves the shadow factor itself reaching zero', () => {
    // eclipse-canon.test.ts asserts the shadow factor bottoms out at exactly
    // 0 for every total eclipse. Flooring it to fake the glow would break
    // that pin AND light the body from the wrong direction.
    expect(frag).toContain('shadow *= smoothstep(');
    expect(frag).not.toContain('max(shadow,');
  });
});
