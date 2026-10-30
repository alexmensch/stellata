import { describeCommittedRoundTrip } from '../util/tsv/committed-round-trip';
import { EVENTS } from './events-tsv';

describeCommittedRoundTrip(EVENTS);
