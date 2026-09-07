import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogChunkFilename, readCatalogHeader } from '../scripts/catalog/catalog-pure';

const ROOT = resolve(__dirname, '..');
const CHUNK = join(ROOT, 'public', catalogChunkFilename(0));

/** AT-HYG's frozen spine row count, which is a different quantity from the
 *  shipped record count and is documented as such in
 *  `docs/catalog-driver.md`. Every other 313-prefixed star figure is the
 *  superseded one. */
const ATHYG_SPINE_ROWS = '313,257';

/** The rounding every prose surface quotes. § rounds to the figure the prose
 *  quotes derives the same string from the built artifact, so a refresh that
 *  moves the catalogue fails there and the sweep starts from this constant. */
const PROSE_ROUNDED = '390k';

// A digit separator hides the figure from a bare `313,000` pattern, which is
// how `scripts/dust/prefilter/cost.ts` held `313_000` through two count
// changes — 24 % low, and driving every ratio that tool prints.
const MYTHOS = /\b313[,_]?000\b|\b313k\b/;

// Root-level config and metadata carry the figure too, and listing the
// directories alone let `vitest.config.ts` hold `313k` through the sweep that
// exists to remove it.
const ROOT_FILES = [
  'AGENTS.md', 'README.md', 'SCIENCE.md', 'RELEASING.md', 'CITATION.cff',
  'vitest.config.ts', 'vite.config.ts', 'package.json', 'public/llms.txt',
];

/** The surfaces a reader meets the catalogue's size on, where the figure IS
 *  the claim rather than a passing aside. `public/llms.txt` is here because
 *  `public/` is otherwise gitignored, so no directory root reaches it. */
const PROSE_SURFACES = [
  'README.md', 'CITATION.cff', 'public/llms.txt', 'src/client/index.html',
];

/** Any three-hundred-thousand-odd star figure: `380,000`, `~384k`, `390k`. */
const SIZE_FIGURE = /\b3\d\d(?:,\d{3}|k)\b/g;

function scannedFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src', 'docs', 'scripts', 'tests',
    ...ROOT_FILES], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => /\.(ts|js|md|html|css|cff|json|txt)$/.test(f))
    .filter((f) => f !== 'tests/star-count-consistency.test.ts');
}

describe('the catalogue states its own size', () => {
  // Artifact-backed, so a checkout that has not run build:catalog skips
  // rather than failing — the same rule the corpus suites follow.
  const built = existsSync(CHUNK);

  // Every count a USER sees is read live — `catalog.count` in the About
  // modal, the catalogue header via VITE_STAR_COUNT on the gate and in
  // index.html. Prose cannot read anything, so it rounds; this is what
  // keeps the rounding true.
  it.skipIf(!built)('rounds to the figure the prose quotes', () => {
    const buf = readFileSync(CHUNK);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const { count } = readCatalogHeader(bytes as ArrayBuffer);

    // A catalogue refresh that moves this fails here rather than silently
    // ageing every README: grep the corpus for the PROSE_ROUNDED figure
    // below, sweep, then move the constant.
    expect(`${Math.round(count / 10_000) * 10}k`).toBe(PROSE_ROUNDED);
  });

  // "Over 380,000" stayed literally true of 388,068 while landing a whole
  // 10k bucket below the rounding above, so nothing caught it: the rounding
  // assertion never greps, and the 313k scan looks for one retired figure.
  // This reads every size figure on the surfaces and holds them to one answer.
  it('quotes one catalogue size on every surface a reader meets it on', () => {
    const allowed = new Set([PROSE_ROUNDED, PROSE_ROUNDED.replace('k', ',000')]);
    const offenders: string[] = [];
    for (const f of PROSE_SURFACES) {
      readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        for (const found of line.replaceAll(ATHYG_SPINE_ROWS, '').matchAll(SIZE_FIGURE)) {
          if (!allowed.has(found[0])) {
            offenders.push(`${f}:${i + 1}: ${found[0]} — ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  // The rendered set has been larger than the AT-HYG spine ever since
  // binary components started being minted, so "313,000 stars" understates
  // it by over sixteen thousand and reads as the catalogue's size.
  it('carries no trace of the superseded 313k figure', () => {
    const offenders: string[] = [];
    for (const f of scannedFiles()) {
      readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
        if (MYTHOS.test(line.replaceAll(ATHYG_SPINE_ROWS, ''))) {
          offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('leaves the AT-HYG spine figure alone, since it is a different count', () => {
    const driver = readFileSync(join(ROOT, 'docs/catalog-driver.md'), 'utf8');
    expect(driver).toContain(ATHYG_SPINE_ROWS);
  });
});
