// A binary eclipse changes brightness slowly enough that the render gate's
// 30 s cap already bounds it — which is why the eclipse dim needs no budget
// of its own. See src/client/binaries/eclipse/README.md § Cadence.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  CADENCE_CAP_SIM_S,
  CADENCE_JND_MAG,
} from '../src/client/render-gate/clock-cadence-pure';

const TSV = 'data/binaries/multiples.tsv';
const R_SUN_AU = 0.00465047;
/** Two 1-R_sun stars — the eclipse geometry the screen for a pair is
 *  drawn against. Wider than most catalogue members, so the ingress it
 *  implies is the SHORT one, which is the conservative direction. */
const PAIR_DIAMETER_AU = 2 * R_SUN_AU;
/** Deepest total eclipse for equal stars: the flux halves, 2.5·log10(2). */
const MAX_DEPTH_MAG = 0.753;

interface Pair { P: number; a: number; i: number; e: number }

function eclipsingPairs(): Pair[] {
  const text = readFileSync(TSV, 'utf8').split('\n');
  const head = text[0].split('\t');
  const col = (n: string) => head.indexOf(n);
  const [cP, cA, cI, cE] = [col('P_days'), col('a_AU'), col('i_rad'), col('e')];
  const out: Pair[] = [];
  for (let r = 1; r < text.length; r++) {
    const f = text[r].split('\t');
    if (f.length < head.length) continue;
    const P = Number(f[cP]); const a = Number(f[cA]);
    const i = Number(f[cI]); const e = Number(f[cE] || '0');
    if (!(P > 0) || !(a > 0) || !Number.isFinite(i)) continue;
    // Geometric eclipse condition for the assumed pair radii.
    if (Math.abs(Math.cos(i)) >= PAIR_DIAMETER_AU / a) continue;
    out.push({ P, a, i, e: Number.isFinite(e) ? e : 0 });
  }
  return out;
}

/** Tightest sim-time step in which any catalogue eclipse can move a JND. */
function tightestBudgetS(pairs: readonly Pair[]): number {
  let tightest = Number.POSITIVE_INFINITY;
  for (const { P, a, e } of pairs) {
    // Relative speed at periapsis, AU/s — the fastest the pair ever closes.
    const v = ((2 * Math.PI * a) / (P * 86400))
      * Math.sqrt((1 + e) / Math.max(1 - e, 1e-6));
    const ingressS = PAIR_DIAMETER_AU / v;
    const budget = CADENCE_JND_MAG / (MAX_DEPTH_MAG / ingressS);
    if (budget < tightest) tightest = budget;
  }
  return tightest;
}

describe.skipIf(!existsSync(TSV))('clock-cadence eclipse rate', () => {
  it('no catalogue eclipse outruns the cap, so the dim needs no own budget', () => {
    const pairs = eclipsingPairs();
    // A refresh that dropped every eclipsing pair would make this vacuous.
    expect(pairs.length).toBeGreaterThan(20);
    const tightest = tightestBudgetS(pairs);
    // Measured 2026-08-23: 48.6 s against a 30 s cap — a 1.6x margin. The
    // margin is what lets the binary eclipse dim declare no budget at all
    // instead of holding frames. A refresh bringing in a tighter pair
    // fails here rather than showing up as a stepped dip on screen.
    expect(tightest).toBeGreaterThanOrEqual(CADENCE_CAP_SIM_S);
  });

  it('a planetary shadow ingress DOES outrun it — hence the planet term', () => {
    // Io crossing Jupiter's shadow: it goes dark over its own diameter at
    // its own orbital speed, two orders faster than any stellar eclipse,
    // which is why PlanetBodyField folds a photometric term in and the
    // binary field does not.
    const ioDiameterKm = 3642;
    const ioSpeedKmS = 17.3;
    const ingressS = ioDiameterKm / ioSpeedKmS;
    // The dim sweeps 0..1 over the ingress; a JND is ~1% of full flux.
    const budget = CADENCE_JND_MAG * ingressS;
    expect(budget).toBeLessThan(CADENCE_CAP_SIM_S);
    expect(budget).toBeLessThan(5);
  });
});
