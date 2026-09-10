/** Every figure the public pages quote, counted off what it describes.
 *  `vite.env.ts` publishes these; README.md is where each comes from. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalogChunkFilename, readCatalogHeader } from '../catalog/record/catalog-pure.ts';
import { walkFiles } from '../util/walk-files.ts';

/** The modelling record the reference count describes: the two root docs
 *  plus every markdown file under these roots — the science docs and the
 *  folder READMEs, which carry a subsystem's citations next to its code. */
const RECORD_DOCS = ['SCIENCE.md', 'README.md'];
const RECORD_ROOTS = ['docs', 'src', 'scripts', 'data'];

const APP_DOC = 'src/client/app/index.html';

// Resolved from this module rather than from the caller's root: the snapshot
// is source, committed beside the build that writes it, where `public/` is a
// generated tree whose location a worktree can move.
const COUNT_SNAPSHOT = join(import.meta.dirname, '../catalog/build-catalog-expected.json');

/**
 * Records in the shipped catalogue. Read from the built artifact's own
 * header, falling back to the build's committed count snapshot on a checkout
 * that has not run `build:catalog` — the two cannot disagree, because
 * `build-catalog` refuses to write an artifact whose counts drift from that
 * snapshot without `UPDATE_BUILD_COUNTS=1`.
 */
export function catalogueRecordCount(root: string): number {
  try {
    const buf = readFileSync(join(root, 'public', catalogChunkFilename(0)));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return readCatalogHeader(bytes as ArrayBuffer).count;
  } catch {
    return JSON.parse(readFileSync(COUNT_SNAPSHOT, 'utf8')).recordCount;
  }
}

/** Every credited source in the application's Credits tab is one `<div>`
 *  child of a `.credit-entry` that is not the entry's own label. */
export function creditedSourceCount(root: string): number {
  const app = readFileSync(join(root, APP_DOC), 'utf8');
  const block = app.slice(app.indexOf('class="modal-credits"'));
  const credits = block.slice(0, block.indexOf('</div>\n          </div>'));
  return [...credits.matchAll(/^\s*<div>(?!<div)/gm)].length;
}

function recordFiles(root: string): string[] {
  const walked = RECORD_ROOTS.flatMap((dir) => [
    ...walkFiles(join(root, dir), {
      include: (path) => path.endsWith('.md'),
      skipDir: (name) => name === 'node_modules' || name === 'public',
    }),
  ]);
  return [...RECORD_DOCS.map((f) => join(root, f)), ...walked];
}

/**
 * Distinct author-year citations across the modelling record, counting only
 * the multi-author forms (`Høg et al. 2000`, `Bland-Hawthorn & Gerhard
 * 2016`). Single-author citations are real references this cannot see, so
 * the result is a floor on the record rather than a measure of it — which is
 * the direction a public claim needs to be wrong in.
 */
export function citedReferences(root: string): Set<string> {
  const pattern =
    /\b([A-Z][A-Za-zÀ-ÿ'-]+)(?:,? (?:et al\.|(?:&(?:amp;)?|and) [A-Z][A-Za-zÀ-ÿ'-]+)) \(?((?:1[89]|20)\d{2})[ab]?\)?/g;
  const refs = new Set<string>();
  for (const file of recordFiles(root)) {
    for (const [, author, year] of readFileSync(file, 'utf8').matchAll(pattern)) {
      refs.add(`${author} ${year}`);
    }
  }
  return refs;
}
