/** The site's `/llms.txt`, built from its template in `src/site/`. README.md#llmstxt. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LLMS_TXT_SOURCE, pageAt } from '../../src/site/pages.ts';
import { llmsTxt } from './page-meta-pure.ts';

export const LLMS_TXT_PATH = `/${LLMS_TXT_SOURCE}`;

export function builtLlmsTxt(siteDir: string): string {
  const home = pageAt('/');
  if (home === null) throw new Error('llms.txt: the site has no page at /');
  return llmsTxt(
    readFileSync(resolve(siteDir, LLMS_TXT_SOURCE), 'utf8'),
    readFileSync(resolve(siteDir, home.source), 'utf8'),
  );
}
