// `pnpm run build:textures-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { runStep } from '../util/emit-artifacts';
import { mirror } from '../util/mirror-to-public';
import { TEXTURES_MIRROR } from './textures-mirror-source';

runStep(() => mirror(TEXTURES_MIRROR.read()));
