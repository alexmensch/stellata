import { describeCommittedRoundTrip } from '../../util/tsv/committed-round-trip';
import { ADDITIONS_LEDGER } from './additions-ledger-tsv';
import { BINDING_REVIEW } from './binding-review-tsv';
import { LABEL_DROPS } from './label-drops-tsv';
import { MEMBERSHIP_MANIFEST } from './membership-manifest-tsv';

describeCommittedRoundTrip(MEMBERSHIP_MANIFEST);
describeCommittedRoundTrip(ADDITIONS_LEDGER);
describeCommittedRoundTrip(BINDING_REVIEW);
describeCommittedRoundTrip(LABEL_DROPS);
