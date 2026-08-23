// The shipped catalogue must not undercut the render gate's 30 s cap.
// See src/client/render-gate/README.md § The clock cadence.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { DEFAULT_CATALOG_MANIFEST, loadCatalog } from '../scripts/catalog/catalog-lookup';
import {
  CADENCE_CAP_SIM_S,
  pulsationCadenceBudgetS,
} from '../src/client/render-gate/cadence/clock-cadence-pure';

import {
  buildPulsationSuppressMask,
} from '../src/client/star-pipeline/pulsation/pulsation-suppress-pure';

describe.skipIf(!existsSync(DEFAULT_CATALOG_MANIFEST))('clock-cadence pulsation bound', () => {
  it('the shipped catalogue measures 32.36 s — above the cap, so it never binds', async () => {
    const catalog = await loadCatalog();
    const periodDays: number[] = [];
    const amplitudeMag: number[] = [];
    const varType: number[] = [];
    for (const r of catalog.records()) {
      periodDays.push(r.periodDays);
      amplitudeMag.push(r.amplitudeMag);
      varType.push(r.varType);
    }
    // The runtime's own mask, imported rather than re-derived: a test that
    // rebuilt the eclipser rule here would keep passing after the rule
    // changed, which is the one thing it exists to catch.
    const suppress = buildPulsationSuppressMask(Uint8Array.from(varType));
    const budget = pulsationCadenceBudgetS(periodDays, amplitudeMag, suppress);

    // Pinned, not bounded. The margin over the cap is 8 %, and it rests on
    // a build detail: `encodePeriodUnits` rounds to 0.1 d, so the fastest
    // record the catalogue can carry has P = 0.1 d and the amplitude on
    // that row decides the rest. A refresh moving either has to trip
    // something, which is what this number is for.
    expect(budget).toBeCloseTo(32.36, 1);
    expect(budget).toBeGreaterThan(CADENCE_CAP_SIM_S);
  });

  it('the mask makes no difference TODAY, and is passed anyway', async () => {
    const catalog = await loadCatalog();
    const periodDays: number[] = [];
    const amplitudeMag: number[] = [];
    const varType: number[] = [];
    for (const r of catalog.records()) {
      periodDays.push(r.periodDays);
      amplitudeMag.push(r.amplitudeMag);
      varType.push(r.varType);
    }
    const unmasked = pulsationCadenceBudgetS(periodDays, amplitudeMag);
    const masked = pulsationCadenceBudgetS(
      periodDays, amplitudeMag, buildPulsationSuppressMask(Uint8Array.from(varType)));
    // The fastest record in the catalogue is NOT an eclipser, so the two
    // agree exactly and the 32.36 s above does not rest on the mask. It is
    // still passed, because eclipsers are extrinsically variable and their
    // GCVS amplitudes are not a slope this scene renders — the day a
    // refresh brings in a faster eclipser, the mask is what stops it
    // shortening every frame budget in the app.
    expect(masked).toBe(unmasked);
  });
});
