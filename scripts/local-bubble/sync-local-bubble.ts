// `pnpm run build:local-bubble-sync`: the committed data/ copy → public/. See ../util/README.md (mirror-to-public.ts).

import { mirror } from '../util/mirror-to-public';
import { LOCAL_BUBBLE_MIRROR } from './local-bubble-mirror-source';

export function main(): void {
  mirror(LOCAL_BUBBLE_MIRROR.read());
}
