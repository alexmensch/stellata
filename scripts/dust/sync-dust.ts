// `pnpm run build:dust-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { runStep } from '../util/emit-artifacts';
import { mirror } from '../util/mirror-to-public';
import { DUST_MIRROR } from './dust-mirror-source';

runStep(() => mirror(DUST_MIRROR.read()));
