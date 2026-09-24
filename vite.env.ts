/** Build-time values every Vite config publishes, so app and site read one set. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  catalogueRecordCount,
  citedReferences,
  creditedSourceCount,
} from './scripts/site/site-metrics.ts';

/**
 * The VITE_ prefix, rather than `define`, because only it behaves the same
 * in dev and prod. src/site/README.md#numbers-in-copy.
 */
export function publishBuildEnv(root: string): void {
  process.env.VITE_APP_VERSION = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ).version;
  process.env.VITE_STAR_COUNT = catalogueRecordCount(root).toLocaleString('en-US');
  process.env.VITE_SOURCE_COUNT = String(creditedSourceCount(root));
  process.env.VITE_REFERENCE_COUNT = String(citedReferences(root).size);
}
