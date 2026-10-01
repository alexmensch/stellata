/** What both Vite configs share: the build target and the figures they publish, so app and site read one set. */

import type { Plugin } from 'vite';
import { type Figures, substituteFigures } from './scripts/site/figures-pure.ts';
import {
  appVersion,
  catalogueRecordCount,
  citedReferenceCount,
  creditedSourceCount,
} from './scripts/site/site-metrics.ts';

export const BUILD_TARGET = 'es2022';

export function buildFigures(root: string): Figures {
  return {
    VITE_APP_VERSION: appVersion(root),
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
