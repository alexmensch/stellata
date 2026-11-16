// The lineage build:catalog's allocation asks: membership's files from the last build:membership, pairs' from the last build:binaries, placement's and promotion's from this build.

import { PROMOTION_ADMISSION_CODES, PROMOTION_CODES } from '../catalog/companions/promotion-lineage/promotion-lineage-pure';
import type { IdentityRow } from '../catalog/lineage/identity/identity-pure';
import { lineageLineCode, type LineageLine } from '../catalog/lineage/lineage-row-pure';
import { LINEAGE_STAGES } from '../catalog/lineage/lineage-stages';
import { codeEffects } from '../catalog/lineage/reason-codes/reason-codes-pure';
import {
  MEMBERSHIP_IDENTITY, MEMBERSHIP_STAGE_LINES, PAIRS_IDENTITY, PAIRS_STAGE_LINES,
} from '../catalog/lineage/stage-lineage-source';
import { MEMBERSHIP_ADMISSION_CODES } from '../catalog/membership/membership-lineage-pure';
import type { Upstream } from './allocate-pure';
import { lineageAdmissions, lineageCauses } from './lineage-upstream-pure';
import {
  ALLOCATION_LINEAGE, MEMBERSHIP_LINEAGE, PAIRS_LINEAGE,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export interface CatalogLineage {
  /** Placement's rows whose code removes or re-binds a record; the rest decide nothing for a SID. */
  readonly placementRemovals: readonly LineageLine[];
  readonly promotion: readonly LineageLine[];
  readonly promotionIdentity: readonly IdentityRow[];
}

const UPSTREAM_ORDER = LINEAGE_STAGES.map((s) => s.codes.stage).filter((stage) => stage !== ALLOCATION_LINEAGE.stage);
const EFFECTS = codeEffects(LINEAGE_STAGES.map((s) => s.codes));
const ADMISSIONS = new Set([...MEMBERSHIP_ADMISSION_CODES, ...PROMOTION_ADMISSION_CODES]);

export function catalogUpstream(local: CatalogLineage): Upstream {
  function* lines(): Generator<LineageLine> {
    yield* MEMBERSHIP_STAGE_LINES.read();
    for (const line of PAIRS_STAGE_LINES.read()) if (EFFECTS.get(lineageLineCode(line)) !== 'none') yield line;
    yield* local.placementRemovals;
    yield* local.promotion;
  }
  return {
    causes: (keys) => lineageCauses(
      keys,
      [
        { stage: MEMBERSHIP_LINEAGE.stage, rows: MEMBERSHIP_IDENTITY.read() },
        { stage: PAIRS_LINEAGE.stage, rows: PAIRS_IDENTITY.read() },
        { stage: PROMOTION_CODES.stage, rows: local.promotionIdentity },
      ],
      lines(), EFFECTS, UPSTREAM_ORDER,
    ),
    admissions: (origins) => lineageAdmissions(origins, lines(), (code) => ADMISSIONS.has(code)),
  };
}
