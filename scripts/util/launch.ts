// The one tsx entry: `tsx scripts/util/launch.ts <entry> [args…]` runs that entry's main. See README.md (emit-artifacts.ts entry).

import { runStep } from './emit-artifacts';

const [entry, ...args] = process.argv.slice(2);
if (entry === undefined) throw new Error('usage: tsx scripts/util/launch.ts <entry.ts> [args…]');
await runStep(entry, args);
