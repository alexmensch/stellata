import { describeCommittedRoundTrip } from '../../util/tsv/committed-round-trip';
import { NAMING_DUPLICATES } from './naming-duplicates-tsv';
import { NAMING_PARITY } from './naming-parity-tsv';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';
import { WGSN_NAMES } from './wgsn-names-tsv';

describeCommittedRoundTrip(WGSN_NAMES);
describeCommittedRoundTrip(WGSN_DESIGNATIONS);
describeCommittedRoundTrip(NAMING_PARITY);
describeCommittedRoundTrip(NAMING_DUPLICATES);
