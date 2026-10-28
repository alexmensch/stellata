// A DR transition's risk-set request and cross-match pull, declared; the defaults are the frozen DR2 -> DR3
// dry-run pair (/docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07).

import { defineSource, type Declared } from '../util/sources/source';
import { readNeighbourhoodRows, readRiskIds } from './dr-reconcile-pure';

export function riskRequestSource(declared: Declared) {
  return defineSource({ ...declared, parse: (input) => readRiskIds(input.text(), input) });
}

export function neighbourhoodSource(declared: Declared) {
  return defineSource({
    ...declared,
    parse: (input, riskCol: string, candidateCol: string) =>
      readNeighbourhoodRows(input.text(), riskCol, candidateCol, input),
  });
}

export const RISK_REQUEST_HINT = 'Re-export it with `pnpm run sid:risk-set`.';
export const NEIGHBOURHOOD_HINT = 'Re-pull it per /docs/sid.md#61-procedure.';

export const DR2_NEIGHBOURHOOD_REQUEST = riskRequestSource({
  file: 'data/gaia/gaia_dr2_neighbourhood_request.tsv',
  hint: 'It is the frozen dry-run snapshot: restore it from git.',
});

export const DR2_NEIGHBOURHOOD = neighbourhoodSource({
  file: 'data/gaia/gaia_dr2_neighbourhood.tsv',
  hint: NEIGHBOURHOOD_HINT,
});
