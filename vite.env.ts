/**
 * Build-time values every Vite config in the repo publishes, so the app and
 * the public site read one set.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  catalogueRecordCount,
  citedReferences,
  creditedSourceCount,
} from './scripts/site/site-metrics.ts';

/**
 * The VITE_ prefix is the supported way to inject build-time values that
 * work in both dev and prod (`define` behaves differently across the two).
 * Each is also an HTML substitution — `%VITE_STAR_COUNT%` — which is what
 * keeps a figure a page states off the list of things a human maintains.
 */
export function publishBuildEnv(root: string): void {
  process.env.VITE_APP_VERSION = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ).version;
  process.env.VITE_STAR_COUNT = catalogueRecordCount(root).toLocaleString('en-US');
  process.env.VITE_SOURCE_COUNT = String(creditedSourceCount(root));
  process.env.VITE_REFERENCE_COUNT = String(citedReferences(root).size);
}
