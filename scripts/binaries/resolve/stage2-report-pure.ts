// Stage 2's build-log lines, read off the Stage2Result it returned.

import { count, countsListed } from '../build-log-pure';
import { BINDING_INTEGRITY_COUNT_KEYS, bindingIntegrityCounts } from './binding-audit-pure';
import { refusalTally, type Stage2Result } from './resolve-pairs';

export function stage2Report(result: Stage2Result): string[] {
  const rejected = refusalTally(result);
  const audit = bindingIntegrityCounts(result.verdicts);
  return [
    `ORB6 coordinate check: ${count(rejected.orb6_hip_off_coord)} ORB6 HIPs off the pair's WDS coordinate`,
    `sibling-identity rejections: ${count(rejected.ccdm_sibling_owned)} CCDM candidates owned by another letter, `
      + `${count(rejected.position_match_sibling_claimed)} manifest position matches onto a star another letter already binds`,
    `seeded ${count(result.synthesizedSeeds.length)} synthesized-pair component bindings`,
    `binding-integrity audit (enforced): ${countsListed(Object.fromEntries(BINDING_INTEGRITY_COUNT_KEYS.map((k) => [k, audit[k]])))}`,
  ];
}
