// refresh:simbad-idents — SIMBAD's designation idents and each object's catalogue keys. See README.md.

import type { PullDescription } from '../../util/emit-artifacts';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { SIMBAD_IDENTS_OUTPUTS } from './simbad-idents-outputs';
import { identsPull, type IdentsRequest } from './simbad-idents-pure';
import { SPTYPE_OIDS } from './sptype-oids-source';

export const readIdentsRequest = (): IdentsRequest => ({ oids: SPTYPE_OIDS.read(), requestFrom: [SPTYPE_OIDS.file] });

const pull = () => identsPull(SIMBAD_IDENTS_OUTPUTS, readIdentsRequest());

export const describe = (): PullDescription => describePhasedPull(pull());
export const main = (): Promise<void> => runPhasedPull(pull());
