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

const MYTHOS = /\b313,000\b|\b313000\b|\b313k\b/;

function scannedFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src', 'docs', 'scripts', 'tests',
    'AGENTS.md', 'README.md', 'SCIENCE.md'], { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => /\.(ts|js|md|html|css)$/.test(f))
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
    // ageing every README: re-derive with
    // `grep -rn '\b380k\b' src docs scripts tests`, sweep, then update.
    expect(`${Math.round(count / 10_000) * 10}k`).toBe('380k');
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
