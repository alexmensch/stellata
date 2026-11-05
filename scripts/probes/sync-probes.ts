// `pnpm run build:probes-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { mirror } from '../util/mirror-to-public';
import { PROBES_MIRROR } from './probes-mirror-source';

export function main(): void {
  mirror(PROBES_MIRROR.read());
}
