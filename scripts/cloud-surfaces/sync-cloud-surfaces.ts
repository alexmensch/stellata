// `pnpm run build:cloud-surfaces-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { mirror } from '../util/mirror-to-public';
import { CLOUD_SURFACES_MIRROR } from './cloud-surfaces-mirror-source';

export function main(): void {
  mirror(CLOUD_SURFACES_MIRROR.read());
}
