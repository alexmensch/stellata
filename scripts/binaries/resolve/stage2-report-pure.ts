// Stage 2's build-log lines, read off the Stage2Result it returned.

import { fold } from '../../util/counts/tally-pure';
import { count } from '../build-log-pure';
import { BINDING_INTEGRITY_COUNT_KEYS, bindingIntegrityCounts } from './binding-audit-pure';
import { SIBLING_REJECTION_TIERS } from './cascade-pure';
import type { Stage2Result } from './resolve-pairs';

export function stage2Report(result: Stage2Result): string[] {
  const rejected = fold(SIBLING_REJECTION_TIERS, result.siblingRejections, (r) => r.tier);
  const audit = bindingIntegrityCounts(result.verdicts);
  return [
    `sibling-identity rejections: ${count(rejected.ccdm_sibling_owned)} CCDM candidates owned by another letter, `
      + `${count(rejected.athyg_match_sibling_claimed)} AT-HYG position matches onto a row another letter already binds`,
    `seeded ${count(result.synthesizedSeeds.length)} synthesized-pair component bindings`,
    `binding-integrity audit (enforced): ${BINDING_INTEGRITY_COUNT_KEYS.map((k) => `${k}=${count(audit[k])}`).join(', ')}`,
  ];
}
