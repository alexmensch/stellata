import { describeCommittedRoundTrip } from '../util/tsv/committed-round-trip';
import { EVENTS } from './events-tsv';

Object.values(EVENTS).forEach((events) => describeCommittedRoundTrip(events));
