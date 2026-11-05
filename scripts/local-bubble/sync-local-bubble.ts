// `pnpm run build:local-bubble-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { runStep } from '../util/emit-artifacts';
import { mirror } from '../util/mirror-to-public';
import { LOCAL_BUBBLE_MIRROR } from './local-bubble-mirror-source';

runStep(() => mirror(LOCAL_BUBBLE_MIRROR.read()));
