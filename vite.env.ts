/** Build-time figures every Vite config publishes, so app and site read one set. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { type Figures, substituteFigures } from './scripts/site/figures-pure.ts';
import {
  catalogueRecordCount,
  citedReferenceCount,
  creditedSourceCount,
} from './scripts/site/site-metrics.ts';

export function buildFigures(root: string): Figures {
  return {
    VITE_APP_VERSION: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
    VITE_STAR_COUNT: catalogueRecordCount(root).toLocaleString('en-US'),
    VITE_SOURCE_COUNT: String(creditedSourceCount(root)),
    VITE_REFERENCE_COUNT: String(citedReferenceCount(root)),
  };
}

/**
 * The VITE_ prefix, rather than `define`, because only it behaves the same
 * in dev and prod. src/site/README.md#numbers-in-copy.
 */
export function publishBuildEnv(figures: Figures): void {
  Object.assign(process.env, figures);
}

/** Ordered ahead of Vite's own `%ENV%` pass, which leaves an unknown token in the page with only a warning. */
export function figureSubstitution(figures: Figures): Plugin {
  return {
    name: 'stellata:figures',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => substituteFigures(html, figures, ctx.filename),
    },
  };
}
