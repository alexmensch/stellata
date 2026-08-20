// The shipped catalogue must not undercut the render gate's idle floor.
// See src/client/render-gate/README.md § The clock cadence.

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { DEFAULT_CATALOG_MANIFEST, loadCatalog } from '../scripts/catalog/catalog-lookup';
import { VAR_TYPE_ECLIPSING } from '../scripts/catalog/catalog-pure';
import {
  CADENCE_CAP_SIM_S,
  pulsationCadenceBudgetS,
} from '../src/client/render-gate/clock-cadence-pure';

describe.skipIf(!existsSync(DEFAULT_CATALOG_MANIFEST))('clock-cadence idle floor', () => {
  it('no catalogue variable pulses fast enough to undercut the cap', async () => {
    const catalog = await loadCatalog();
    const periodDays: number[] = [];
    const amplitudeMag: number[] = [];
    const suppress: number[] = [];
    for (const r of catalog.records()) {
      periodDays.push(r.periodDays);
      amplitudeMag.push(r.amplitudeMag);
      suppress.push(r.varType === VAR_TYPE_ECLIPSING ? 1 : 0);
    }
    const budget = pulsationCadenceBudgetS(periodDays, amplitudeMag, suppress);
    // The cap is the documented idle floor ("one frame per 30 s at 1×"),
    // and it only holds while it is the SMALLEST of the four budget
    // sources at a still vantage. The margin is thin and rests on a build
    // detail: encodePeriodUnits rounds to 0.1 d, so the fastest record
    // the catalogue can carry has P = 0.1 d, and how tight this gets is
    // then decided by whatever amplitude that row happens to have. A
    // refresh can move it.
    expect(budget).toBeGreaterThanOrEqual(CADENCE_CAP_SIM_S);
  });
});
