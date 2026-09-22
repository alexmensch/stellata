// The TSL half of the shader-constant drift guards: a pinned constant must
// be read from its `*-pure.ts` home, never restated as a literal.
// README.md § Constant drift runs in both directions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATMO_N_LIGHT, ATMO_N_VIEW, LIGHT_JITTER_STRIDE, TWILIGHT_TAIL_AMP,
  TWILIGHT_TAIL_REACH,
} from '../../solar-system/atmosphere/atmosphere-scattering-pure';
import {
  RING_BACKLIT_TRANSMIT, RING_SHADOW_FLOOR,
} from '../../solar-system/planets/rings/ring-photometry-pure';
import {
  DITHER_IGN_DOT, DITHER_IGN_SCALE, LUMA_WEIGHTS,
} from '../../hdr/tonemap/tonemap-pure';
import {
  literalDriftOffenders, type DriftExemption, type PinnedConstant,
} from '../tsl/literal-drift-pure';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const SOURCES: Record<string, string> = {
  'atmosphere-scatter-tsl.ts': read('./atmosphere-scatter-tsl.ts'),
  'planet-mesh-tsl.ts': read('./planet-mesh-tsl.ts'),
  'planet-rings-tsl.ts': read('./planet-rings-tsl.ts'),
  'planet-atmosphere-tsl.ts': read('./planet-atmosphere-tsl.ts'),
  'planet-glare-tsl.ts': read('./planet-glare-tsl.ts'),
  'probe-tsl.ts': read('./probe-tsl.ts'),
};
const ALL = Object.values(SOURCES).join('\n');

/** Every constant whose value is authored once in a `*-pure.ts` module and
 *  read by both shader backends. `identifier` is what the TSL side must
 *  reference; `values` are the numbers that must NOT appear as literals. */
const PINNED: readonly PinnedConstant[] = [
  { identifier: 'ATMO_N_VIEW', values: [ATMO_N_VIEW] },
  { identifier: 'ATMO_N_LIGHT', values: [ATMO_N_LIGHT] },
  { identifier: 'LIGHT_JITTER_STRIDE', values: [LIGHT_JITTER_STRIDE] },
  // The ray-start jitter is the shared helper now, so what these surfaces
  // must reference is the helper rather than the numbers it reads off
  // tonemap-pure (../tsl/jitter-tsl.ts) — and the numbers must still not
  // reappear here as literals, which is what retired ATMO_JITTER_*.
  {
    identifier: 'interleavedGradientNoiseTsl',
    values: [DITHER_IGN_SCALE, ...DITHER_IGN_DOT],
  },
  // Derived from 1/(4π) on both sides rather than rounded, so it has no
  // literal form to forbid — only the reference is pinned.
  { identifier: 'MS_STRENGTH', values: [] },
  { identifier: 'TWILIGHT_TAIL_AMP', values: [TWILIGHT_TAIL_AMP] },
  { identifier: 'TWILIGHT_TAIL_REACH', values: [TWILIGHT_TAIL_REACH] },
  { identifier: 'RING_SHADOW_FLOOR', values: [RING_SHADOW_FLOOR] },
  { identifier: 'RING_BACKLIT_TRANSMIT', values: [RING_BACKLIT_TRANSMIT] },
  { identifier: 'LUMA_WEIGHTS', values: LUMA_WEIGHTS },
];

describe('the TSL surfaces read their shared constants', () => {
  for (const { identifier } of PINNED) {
    it(`references ${identifier}`, () => {
      expect(ALL).toContain(identifier);
    });
  }
});

/** The scan compares by value, so a number that coincides with a pinned
 *  one has to be excused by name. Keep this list short: an entry here
 *  also stops the real constant being caught in that file. */
const EXEMPT: Record<string, readonly DriftExemption[]> = {
  'atmosphere-scatter-tsl.ts': [
    { value: 16, reason: "3/(16π) is the Rayleigh phase normalisation, not ATMO_N_VIEW" },
  ],
};

describe('the TSL surfaces restate no pinned constant as a literal', () => {
  for (const [file, src] of Object.entries(SOURCES)) {
    it(`${file} carries no drifting copy`, () => {
      expect(literalDriftOffenders(src, PINNED, EXEMPT[file])).toEqual([]);
    });
  }
});

/** Comments stripped: a claim must be satisfied by the graph, never by a
 *  comment quoting it. */
const stripped = (src: string) =>
  src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const scatter = stripped(SOURCES['atmosphere-scatter-tsl.ts']);
const meshTsl = stripped(SOURCES['planet-mesh-tsl.ts']);

// The constants above are pinned; these are the expression shapes, and each
// is a plausible picture rather than a failure when it drifts.
describe('the shadow is solved along the ray, not sampled across it', () => {
  it('cuts the cylinder quadratic against the terminator half-space', () => {
    expect(scatter).toContain('b.mul(b).sub(a.mul(c))');
    expect(scatter).toContain('If(dS.greaterThan(0.0), () => { hi.assign(min(hi, th)); })');
    expect(scatter).toContain('.Else(() => { lo.assign(max(lo, th)); });');
  });

  // Points inside the cylinder by impact parameter but in FRONT of the body
  // are lit; without the escape the whole day side goes into shadow.
  it('keeps the sunward-of-the-terminator escape the cylinder alone misses', () => {
    expect(scatter).toContain('If(oS.greaterThanEqual(0.0), () => { enters.assign(bool(false)); });');
  });

  it('holds the parallel-ray case, where the impact parameter never changes', () => {
    expect(scatter).toContain('If(c.greaterThanEqual(0.0), () => {');
    expect(scatter).toContain('lo.assign(-SHADOW_FAR);');
    expect(scatter).toContain('hi.assign(SHADOW_FAR);');
  });

  // A [1, 0] sentinel only reads as empty for ray parameters outside it.
  it('leaves the empty span inverted and unbounded', () => {
    expect(scatter).toContain('const s0 = float(SHADOW_FAR).toVar();');
    expect(scatter).toContain('const s1 = float(-SHADOW_FAR).toVar();');
  });

  // Inside the loop it would still be exact, just ATMO_N_VIEW× the cost.
  it('solves the span once per ray, outside the march', () => {
    const call = scatter.indexOf('shadowSpanTsl(o, d, sunDir)');
    const loop = scatter.indexOf('Loop(ATMO_N_VIEW');
    expect(call).toBeGreaterThan(0);
    expect(call).toBeLessThan(loop);
  });

  it('weights each sample by its segment’s coverage, at half the march step', () => {
    expect(scatter).toContain('litFractionTsl(t, segLen.mul(0.5), shadow.x, shadow.y)');
  });

  // `t` is the ray parameter from the camera, so `t ± h` are large and
  // nearly equal and the 1/(2h) amplifies what float32 loses between them.
  // Taking both bounds as offsets from `t` is what keeps deep shadow exactly
  // 0 rather than jitter-patterned sunlight on the anti-solar face — a
  // camera-anywhere failure, not a Sol-today one. Assert the whole body at
  // once: `t` may appear ONLY as a subtrahend, never summed with `h`.
  it('clamps the coverage bounds to the segment BEFORE differencing them', () => {
    const body = scatter.match(
      /litFractionTsl = [^=]*=>\s*\{([\s\S]*?)\n\s*\},\n\);/,
    );
    expect(body).not.toBeNull();
    expect(body![1].replace(/\s+/g, '')).toBe(
      'constlo=max(s0.sub(t),h.negate());'
      + 'consthi=min(s1.sub(t),h);'
      + 'returnfloat(1.0).sub(max(hi.sub(lo),0.0).div(h.mul(2.0)));',
    );
  });
});

describe('the march runs in the frame where the oblate body is a unit sphere', () => {
  it('scales only the polar component, and inverts by scaling back', () => {
    expect(scatter).toContain('v.add(pole.mul(dot(v, pole).mul(s.sub(1.0))))');
    expect(scatter).toContain('float(1.0).div(polarR)');
  });

  // Miss the sun direction and the shadow cylinder tilts against the body it
  // is cast by; miss the camera and the unit-sphere geometry describes a
  // body that is not the one drawn.
  it('deflattens the camera and the sun direction through the shared helpers', () => {
    expect(meshTsl).toContain('deflattenedCameraTsl(');
    expect(meshTsl).toContain('deflattenedDirTsl(');
  });

  // uRadiusPc·normal is a point on the equatorial-radius SPHERE, up to f·R
  // outside the spheroid fragment being shaded — at the limb that collapsed
  // the airlight chord and left a dark seam against the halo.
  it('reads the surface point off the SQUASHED normal', () => {
    expect(meshTsl).toContain('scalePolarTsl(n, p.uPoleView, p.uPolarRadiusR).normalize()');
  });
});

describe('skylight on the surface', () => {
  it('hangs the twilight falloff on the shadow-edge altitude over the scale height', () => {
    expect(scatter).toContain('const h = shadowEdgeAltitudeTsl(sunCos);');
    expect(scatter).toContain('exp(h.negate().div(hR))');
    expect(scatter).toContain('exp(h.negate().div(hR.mul(TWILIGHT_TAIL_REACH))).mul(TWILIGHT_TAIL_AMP)');
  });

  it('derives the terminator anchor from the Chapman column, not a fixed fraction', () => {
    expect(scatter).toContain('sqrt(float(Math.PI).div(hR.mul(2.0)))');
    expect(scatter).toContain('const tBar = vec3(1.0).sub(exp(x.negate())).div(x);');
    expect(scatter).toContain('tauScatter.mul(0.25).mul(tBar).mul(exp(tauAbsorb.negate()))');
  });

  // Both describe the same photons at opposite solar elevations, so carrying
  // the horizon-sun anchor to noon double-counts it.
  it('partitions the anchor against the beam term instead of summing them', () => {
    expect(scatter).toContain('const mu = max(sunCos, 0.0);');
    expect(scatter).toContain('tauScatter.div(tauExt).mul(mu.mul(0.5))');
    expect(scatter).toContain('return fTerm.mul(tail.mul(float(1.0).sub(mu))).add(beam);');
  });

  // It is light reflected off the ground, so it needs the albedo-bearing
  // scalar; folding it into the airlight would skip the surface entirely.
  it('rides the surface scalar, added to the direct term rather than the airlight', () => {
    expect(meshTsl).toContain('col.addAssign(surfaceScale.mul(skyIrradianceTsl(');
  });

  // One redirects light, the other removes it.
  it('splits scattering from absorption', () => {
    expect(scatter).toContain('betaRs.mul(hR).add(vec3(betaMs.mul(hM)))');
    expect(meshTsl).toContain('verticalScatterTauTsl(');
  });
});

// The fill is not the small correction its name suggests — it leads the
// airlight except in back-lit geometry.
describe('the multiple-scattering fill', () => {
  it('accumulates without scaling single scatter', () => {
    expect(scatter).toContain('ssAlbedo.mul(vec3(1.0).sub(transmittance))');
    expect(scatter).toContain('litSum.div(ATMO_N_VIEW).mul(MS_STRENGTH)');
  });
});
