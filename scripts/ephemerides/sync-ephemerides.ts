// `pnpm run build:ephemerides-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { runStep } from '../util/emit-artifacts';
import { mirror } from '../util/mirror-to-public';
import { EPHEMERIDES_MIRROR } from './ephemerides-mirror-source';

runStep(() => mirror(EPHEMERIDES_MIRROR.read()));
