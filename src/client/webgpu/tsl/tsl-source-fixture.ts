// Reading a shipped TSL module as text, for the suites that pin expression
// shapes. See README.md § TSL test pattern.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The module's source with every comment removed. These modules carry long
 *  comments that quote their own expressions, so a `toContain` over the raw
 *  text can be satisfied by prose ABOUT the graph rather than by the graph —
 *  the one way a source scan passes while the claim it makes is false. */
export function readTslSource(url: URL): string {
  return readFileSync(fileURLToPath(url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}
