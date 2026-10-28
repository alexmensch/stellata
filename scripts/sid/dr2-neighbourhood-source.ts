// The DR2 -> DR3 dry run's pair, declared: sid:risk-set's request and the cross-match pull it fed.

import { relative } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { defineSource, type Declared } from '../util/sources/source';
import { readNeighbourhoodRows, readRiskIds } from './dr-reconcile-pure';
import { DR_RISK_SET_OUTPUTS } from './dr-risk-set-outputs';

export const RISK_REQUEST_HINT = 'Re-run `pnpm run sid:risk-set`.';
export const NEIGHBOURHOOD_HINT = 'Re-pull it per /docs/sid.md#61-procedure.';

const REQUEST_FROM: Declared = {
  file: relative(REPO_ROOT, DR_RISK_SET_OUTPUTS.files.request),
  hint: RISK_REQUEST_HINT,
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
