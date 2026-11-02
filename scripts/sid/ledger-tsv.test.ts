
import { describeCommittedRoundTrip } from '../util/tsv/committed-round-trip';
import { LEDGERS } from './ledger-tsv';

Object.values(LEDGERS).forEach((ledger) => describeCommittedRoundTrip(ledger));
