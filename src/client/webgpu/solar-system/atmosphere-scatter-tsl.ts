// TSL mirror of atmosphere-scatter.glsl: ray helpers, the analytic shadow
// span, the skylight model, and the single-scattering march. Model and
// calibration: ../../solar-system/atmosphere/README.md.

import {
  Fn, If, Loop, abs, bool, dot, exp, float, fract, length, max, min, sqrt, vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  ATMO_JITTER_COEFFS, ATMO_JITTER_SCALE, ATMO_N_LIGHT, ATMO_N_VIEW,
  LIGHT_JITTER_STRIDE, MS_STRENGTH, TWILIGHT_TAIL_AMP, TWILIGHT_TAIL_REACH,
} from '../../solar-system/atmosphere/atmosphere-scattering-pure';
import { LUMA_WEIGHTS } from '../../hdr/tonemap-pure';

type NF = Node<'float'>;
type N2 = Node<'vec2'>;
type N3 = Node<'vec3'>;

const RAYLEIGH_PHASE_K = 3.0 / (16.0 * Math.PI);
const INV_4PI = 1.0 / (4.0 * Math.PI);

/** Stands in for an unbounded shadow span; only ever min/maxed against a
 *  ray parameter, never multiplied, so it just has to dwarf one. */
const SHADOW_FAR = 1e20;

export const rayleighPhaseTsl = /* @__PURE__ */ Fn(
  ([mu]: [NF]) => mu.mul(mu).add(1.0).mul(RAYLEIGH_PHASE_K),
);

export const miePhaseTsl = /* @__PURE__ */ Fn(([mu, g]: [NF, NF]) => {
  const g2 = g.mul(g);
  const denom = max(g2.add(1.0).sub(g.mul(mu).mul(2.0)), 1e-6);
  return float(INV_4PI).mul(float(1.0).sub(g2)).div(denom.mul(sqrt(denom)));
});

/** Interleaved gradient noise over the fragment position — the per-fragment
 *  offset that turns the few-sample lattice into fine grain instead of a
 *  fixed moiré. */
export const atmoJitterTsl = /* @__PURE__ */ Fn(
  ([fragCoord]: [N2]) => fract(fract(dot(fragCoord, vec2(...ATMO_JITTER_COEFFS)))
    .mul(ATMO_JITTER_SCALE)),
);

export const atmoLumaTsl = /* @__PURE__ */ Fn(
  ([c]: [N3]) => dot(c, vec3(...LUMA_WEIGHTS)),
);

/** Second (far) positive root of |o + t·d| = radius, or -1 on a miss. */
export const farRootTsl = /* @__PURE__ */ Fn(([o, d, radius]: [N3, N3, NF]) => {
  const b = dot(o, d);
  const disc = b.mul(b).sub(dot(o, o).sub(radius.mul(radius)));
  const root = float(-1.0).toVar();
  If(disc.greaterThanEqual(0.0), () => {
    root.assign(b.negate().add(sqrt(disc)));
  });
  return root;
});

/** Camera-ray entry against the atmosphere shell, as `(disc, t0, t1)` —
 *  the roots are meaningful only where the discriminant is positive. */
export const shellEntryTsl = /* @__PURE__ */ Fn(([o, dir, rAtmo]: [N3, N3, NF]) => {
  const b = dot(o, dir);
  const disc = b.mul(b).sub(dot(o, o).sub(rAtmo.mul(rAtmo))).toVar();
  const root = float(0.0).toVar();
  If(disc.greaterThan(0.0), () => { root.assign(sqrt(disc)); });
  return vec3(disc, b.negate().sub(root), b.negate().add(root));
});

/** True when `o + t·dir` (t > 0) enters the unit body sphere ahead of the
 *  camera — the shell shader discards these so the disc path owns them. */
export const hitsBodyAheadTsl = /* @__PURE__ */ Fn(([o, dir]: [N3, N3]) => {
  const b = dot(o, dir);
  const disc = b.mul(b).sub(dot(o, o).sub(1.0)).toVar();
  const hit = bool(false).toVar();
  If(disc.greaterThan(0.0), () => {
    hit.assign(b.negate().sub(sqrt(disc)).greaterThan(0.0));
  });
  return hit;
});

/** Scale a vector's component along `pole` by s, leaving the equatorial
 *  part alone — the seam between an oblate body and a march that assumes a
 *  unit sphere. */
export const scalePolarTsl = /* @__PURE__ */ Fn(([v, pole, s]: [N3, N3, NF]) =>
  v.add(pole.mul(dot(v, pole).mul(s.sub(1.0)))));

/** The camera — at the view-space origin — relative to the body centre in
 *  planet-radius units, in the unit-sphere frame. */
export const deflattenedCameraTsl = /* @__PURE__ */ Fn(
  ([centreView, radiusPc, pole, polarR]: [N3, NF, N3, NF]) =>
    scalePolarTsl(centreView.negate().div(radiusPc), pole, float(1.0).div(polarR)),
);

/** A unit direction in the same frame. The map is not a similarity, so the
 *  result needs renormalising even though `v` arrives unit. */
export const deflattenedDirTsl = /* @__PURE__ */ Fn(
  ([v, pole, polarR]: [N3, N3, NF]) =>
    scalePolarTsl(v, pole, float(1.0).div(polarR)).normalize(),
);

/**
 * The planetary shadow along `o + t·d` as the single t-interval it always
 * is, returned as `(s0, s1)`; s0 > s1 means the ray never enters it. Solved
 * once per ray, never per sample — the anti-banding argument is
 * `../../solar-system/atmosphere/README.md` § Anti-banding.
 */
export const shadowSpanTsl = /* @__PURE__ */ Fn(([o, d, sunDir]: [N3, N3, N3]) => {
  const oS = dot(o, sunDir).toVar();
  const dS = dot(d, sunDir).toVar();
  const oP = o.sub(sunDir.mul(oS));
  const dP = d.sub(sunDir.mul(dS));
  const a = dot(dP, dP).toVar();
  const b = dot(oP, dP).toVar();
  const c = dot(oP, oP).sub(1.0).toVar();

  const lo = float(0.0).toVar();
  const hi = float(0.0).toVar();
  const enters = bool(true).toVar();

  If(a.greaterThan(1e-12), () => {
    const disc = b.mul(b).sub(a.mul(c)).toVar();
    If(disc.lessThanEqual(0.0), () => {
      enters.assign(bool(false));
    }).Else(() => {
      const r = sqrt(disc);
      lo.assign(b.negate().sub(r).div(a));
      hi.assign(b.negate().add(r).div(a));
    });
  }).Else(() => {
    // Ray parallel to the shadow axis: its impact parameter never changes.
    If(c.greaterThanEqual(0.0), () => {
      enters.assign(bool(false));
    }).Else(() => {
      lo.assign(-SHADOW_FAR);
      hi.assign(SHADOW_FAR);
    });
  });

  If(enters, () => {
    If(abs(dS).greaterThan(1e-12), () => {
      const th = oS.negate().div(dS);
      If(dS.greaterThan(0.0), () => { hi.assign(min(hi, th)); })
        .Else(() => { lo.assign(max(lo, th)); });
    }).Else(() => {
      If(oS.greaterThanEqual(0.0), () => { enters.assign(bool(false)); });
    });
  });

  // Inverted and unbounded, so an empty span reads as empty against any
  // ray parameter.
  const s0 = float(SHADOW_FAR).toVar();
  const s1 = float(-SHADOW_FAR).toVar();
  If(enters, () => { s0.assign(lo); s1.assign(hi); });
  return vec2(s0, s1);
});

/**
 * Fraction of the march segment centred on `t` with half-width `h` that
 * falls outside the shadow span — the exact quadrature weight for a hard
 * shadow, continuous in the ray's geometry so the lit sample count cannot
 * step.
 *
 * Both bounds MUST stay offsets from `t`: `t` is the ray parameter from the
 * camera, so `t ± h` are large and nearly equal and the 1/(2h) amplifies
 * whatever float32 loses between them.
 */
export const litFractionTsl = /* @__PURE__ */ Fn(
  ([t, h, s0, s1]: [NF, NF, NF, NF]) => {
    const lo = max(s0.sub(t), h.negate());
    const hi = min(s1.sub(t), h);
    return float(1.0).sub(max(hi.sub(lo), 0.0).div(h.mul(2.0)));
  },
);

/** Altitude of the planetary shadow's upper edge directly above a surface
 *  point with sun-cosine `sunCos` — 0 on the lit side. Only the column
 *  above it still sees the host. */
export const shadowEdgeAltitudeTsl = /* @__PURE__ */ Fn(([sunCos]: [NF]) => {
  const h = float(0.0).toVar();
  If(sunCos.lessThan(0.0), () => {
    h.assign(float(1.0).div(sqrt(max(float(1.0).sub(sunCos.mul(sunCos)), 1e-12))).sub(1.0));
  });
  return h;
});

/** Vertical scattering optical depth per channel (absorption excluded). */
export const verticalScatterTauTsl = /* @__PURE__ */ Fn(
  ([betaRs, betaMs, hR, hM]: [N3, NF, NF, NF]) =>
    betaRs.mul(hR).add(vec3(betaMs.mul(hM))),
);

/** Skylight: the fraction of host irradiance the atmosphere scatters down
 *  onto the surface, per channel. The horizon-sun anchor and the beam term
 *  describe the same photons at opposite solar elevations, so they
 *  partition (1 − μ) / μ rather than summing. */
export const skyIrradianceTsl = /* @__PURE__ */ Fn(
  ([sunCos, hR, tauScatter, tauAbsorb]: [NF, NF, N3, N3]) => {
    const ch = sqrt(float(Math.PI).div(hR.mul(2.0)));
    const h = shadowEdgeAltitudeTsl(sunCos);
    const tail = exp(h.negate().div(hR))
      .add(exp(h.negate().div(hR.mul(TWILIGHT_TAIL_REACH))).mul(TWILIGHT_TAIL_AMP));
    const tauExt = max(tauScatter.add(tauAbsorb), vec3(1e-6));
    const x = tauExt.mul(ch);
    const tBar = vec3(1.0).sub(exp(x.negate())).div(x);
    const fTerm = tauScatter.mul(0.25).mul(tBar).mul(exp(tauAbsorb.negate()));
    const mu = max(sunCos, 0.0);
    const muSafe = max(mu, 1e-4);
    const beam = tauScatter.div(tauExt).mul(mu.mul(0.5))
      .mul(vec3(1.0).sub(exp(tauExt.negate().div(muSafe))))
      .mul(exp(tauAbsorb.negate().div(muSafe)));
    return fTerm.mul(tail.mul(float(1.0).sub(mu))).add(beam);
  },
);

/** What one march returns: the airlight radiance before sun colour, and the
 *  view-path transmittance the surface behind it loses. `litFrac` is the
 *  chord's sunlit share — the shell's coverage claim reads it. */
export interface AtmosphereMarch {
  inscatter: N3;
  transmittance: N3;
}

/**
 * Airlight radiance + view-path transmittance along `o + t·d` for
 * t ∈ [tStart, tStop]. A plain composition rather than an `Fn`, because TSL
 * has no out-parameter and the two results are wanted separately at both
 * call sites; `jitter` ∈ [0,1) offsets the sample lattice per fragment.
 */
export function atmosphereRadianceTsl(args: {
  o: N3;
  d: N3;
  tStart: NF;
  tStop: NF;
  rAtmo: NF;
  sunDir: N3;
  hR: NF;
  hM: NF;
  betaRs: N3;
  betaMs: NF;
  betaA: N3;
  g: NF;
  jitter: NF;
}): AtmosphereMarch {
  const { o, d, rAtmo, sunDir, hR, hM, betaRs, betaMs, betaA, g, jitter } = args;
  const span = args.tStop.sub(args.tStart).toVar();
  const inscatter = vec3(0.0).toVar();
  const viewOdR = float(0.0).toVar();
  const viewOdM = float(0.0).toVar();
  const litSum = float(0.0).toVar();

  If(span.greaterThan(0.0), () => {
    const segLen = span.div(ATMO_N_VIEW).toVar();
    const shadow = shadowSpanTsl(o, d, sunDir).toVar();
    const mu = dot(d, sunDir);
    const pR = rayleighPhaseTsl(mu).toVar();
    const pM = miePhaseTsl(mu, g).toVar();

    Loop(ATMO_N_VIEW, ({ i }) => {
      const t = args.tStart.add(float(i).add(jitter).mul(segLen)).toVar();
      const p = o.add(d.mul(t));
      const h = max(length(p).sub(1.0), 0.0);
      const dR = exp(h.negate().div(hR)).toVar();
      const dM = exp(h.negate().div(hM)).toVar();
      viewOdR.addAssign(dR.mul(segLen));
      viewOdM.addAssign(dM.mul(segLen));

      const lit = litFractionTsl(t, segLen.mul(0.5), shadow.x, shadow.y).toVar();
      litSum.addAssign(lit);
      const sExit = farRootTsl(p, sunDir, rAtmo).toVar();
      // The GLSL's two `continue`s, expressed as the branch they guard —
      // a jump out of a concise arrow is emitted twice (../README.md
      // § TSL test pattern).
      If(lit.greaterThan(0.0).and(sExit.greaterThan(0.0)), () => {
        // Decorrelate the light-march offset from the view-march (and per
        // view sample) so the two lattices don't beat into a moiré.
        const lightJit = fract(jitter.add(float(i).mul(LIGHT_JITTER_STRIDE)));
        const lStep = sExit.div(ATMO_N_LIGHT).toVar();
        const lightOdR = float(0.0).toVar();
        const lightOdM = float(0.0).toVar();
        Loop(ATMO_N_LIGHT, ({ i: j }) => {
          const q = p.add(sunDir.mul(float(j).add(lightJit).mul(lStep)));
          const hq = max(length(q).sub(1.0), 0.0);
          lightOdR.addAssign(exp(hq.negate().div(hR)).mul(lStep));
          lightOdM.addAssign(exp(hq.negate().div(hM)).mul(lStep));
        });
        const tau = betaRs.mul(viewOdR.add(lightOdR))
          .add(betaA.add(betaMs).mul(viewOdM.add(lightOdM)));
        const scatter = betaRs.mul(dR.mul(pR)).add(betaMs.mul(dM.mul(pM)));
        inscatter.addAssign(scatter.mul(exp(tau.negate())).mul(segLen).mul(lit));
      });
    });
  });

  const transmittance = exp(
    betaRs.mul(viewOdR).add(betaA.add(betaMs).mul(viewOdM)).negate()).toVar();
  // Isotropic multiple-scattering fill: fraction-scattered × opacity ×
  // sunlit. Not the small correction its name suggests — it leads the
  // airlight except in back-lit geometry (README § Multiple-scattering).
  const scatterC = betaRs.add(betaMs);
  const ssAlbedo = scatterC.div(max(scatterC.add(betaA), vec3(1e-6)));
  inscatter.addAssign(
    ssAlbedo.mul(vec3(1.0).sub(transmittance))
      .mul(litSum.div(ATMO_N_VIEW).mul(MS_STRENGTH)));

  return { inscatter, transmittance };
}
