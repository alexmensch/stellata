// The frozen DR2 -> DR3 dry-run pair (/docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07): the request and the cross-match pull it fed.

import { defineSource, type Declared } from '../util/sources/source';
import { readNeighbourhoodRows, readRiskIds } from './dr-reconcile-pure';

export const RISK_REQUEST_HINT = 'Re-export it with `pnpm run sid:risk-set`.';
export const NEIGHBOURHOOD_HINT = 'Re-pull it per /docs/sid.md#61-procedure.';

const REQUEST_FROM: Declared = {
  file: 'data/gaia/gaia_dr2_neighbourhood_request.tsv',
  hint: 'It is the frozen dry-run snapshot: restore it from git.',
};
const NEIGHBOURHOOD_FROM: Declared = {
  file: 'data/gaia/gaia_dr2_neighbourhood.tsv',
  hint: NEIGHBOURHOOD_HINT,
};

export const DR2_NEIGHBOURHOOD_REQUEST = defineSource({
  ...REQUEST_FROM,
  parse: (input) => readRiskIds(input.text(), REQUEST_FROM),
});

export const DR2_NEIGHBOURHOOD = defineSource({
  ...NEIGHBOURHOOD_FROM,
  parse: (input, riskCol: string, candidateCol: string) =>
    readNeighbourhoodRows(input.text(), riskCol, candidateCol, NEIGHBOURHOOD_FROM),
});
