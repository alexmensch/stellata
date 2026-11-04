// `pnpm run build:cloud-surfaces-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { runStep } from '../util/emit-artifacts';
import { mirror } from '../util/mirror-to-public';
import { CLOUD_SURFACES_MIRROR } from './cloud-surfaces-source';

runStep(() => mirror(CLOUD_SURFACES_MIRROR.read()));
