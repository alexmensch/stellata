// Every stage that writes lineage, in pipeline order: what the code list is generated from and trace prints in. See README.md#reason-codes--closed-append-only-generated.

import { PROMOTION_CODES } from '../companions/promotion-lineage-pure';
import { MEMBERSHIP_CODES } from '../membership/membership-lineage-pure';
import type { StageCodes } from './reason-codes-pure';

export const LINEAGE_STAGES: readonly StageCodes<string>[] = [MEMBERSHIP_CODES, PROMOTION_CODES];
