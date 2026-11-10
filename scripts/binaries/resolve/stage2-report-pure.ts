// Stage 2's build-log lines, read off the Stage2Result it returned.

import { count } from '../build-log-pure';
import { BINDING_INTEGRITY_COUNT_KEYS, bindingIntegrityCounts } from './binding-audit-pure';
import { siblingRejectionTally, type Stage2Result } from './resolve-pairs';

export function stage2Report(result: Stage2Result): string[] {
  const rejected = siblingRejectionTally(result);
  const audit = bindingIntegrityCounts(result.verdicts);
  return [
    `sibling-identity rejections: ${count(rejected.ccdm_sibling_owned)} CCDM candidates owned by another letter, `
      + `${count(rejected.athyg_match_sibling_claimed)} AT-HYG position matches onto a row another letter already binds`,
    `seeded ${count(result.synthesizedSeeds.length)} synthesized-pair component bindings`,
    `binding-integrity audit (enforced): ${BINDING_INTEGRITY_COUNT_KEYS.map((k) => `${k}=${count(audit[k])}`).join(', ')}`,
  ];
}
