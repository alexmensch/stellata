// `pnpm run build:ephemerides-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { mirror } from '../util/mirror-to-public';
import { EPHEMERIDES_MIRROR } from './ephemerides-mirror-source';

export function main(): void {
  mirror(EPHEMERIDES_MIRROR.read());
}
