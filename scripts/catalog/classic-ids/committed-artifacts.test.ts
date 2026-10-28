import { describeCommittedRoundTrip } from '../../util/tsv/committed-round-trip';
import { CLASSIC_ID_OVERLAY } from './classic-id-overlay-tsv';
import { LABEL_FLIPS } from './label-merge/label-flips-tsv';
import { REJECTED_BINDINGS } from './rejected-bindings-tsv';
import { ROUTE_DISAGREEMENTS } from './route-disagreements-tsv';

describeCommittedRoundTrip(CLASSIC_ID_OVERLAY);
describeCommittedRoundTrip(ROUTE_DISAGREEMENTS);
describeCommittedRoundTrip(REJECTED_BINDINGS);
describeCommittedRoundTrip(LABEL_FLIPS);
