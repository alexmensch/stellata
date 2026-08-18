// Mechanical half of data/textures/src/README.md § Auditing: the pins read
// each FILE's header, never the prose beside it.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { imageSize, isLfsPointer } from './image-header-pure';

const SRC = new URL('../../data/textures/src/', import.meta.url);
const README = fileURLToPath(new URL('README.md', SRC));

const table = readFileSync(README, 'utf8')
  .split('\n')
  .filter(l => l.startsWith('| `'));

/** Every `WxH` a row states, in order. A row may state its frozen file's size,
 *  the full original it was reduced from, or both. */
const claimedSizes = (row: string): Array<[number, number]> =>
  [...row.matchAll(/\b(\d{3,5})\s*×\s*(\d{3,5})\b/g)]
    .map(m => [Number(m[1]), Number(m[2])] as [number, number]);

const fileOf = (row: string): string => {
  const m = /^\| `([^`]+)`/.exec(row);
  if (!m) throw new Error(`unparseable provenance row: ${row.slice(0, 60)}`);
  return m[1];
};

describe('every provenance row matches the file it describes', () => {
  it('parses a row for each frozen source', () => {
    // A table that stops parsing silently would pass every pin below.
    expect(table.length).toBeGreaterThanOrEqual(24);
  });

  for (const row of table) {
    const name = fileOf(row);
    if (!/\.(jpg|tif|webp)$/.test(name)) continue;

    it(`${name} is the size its row claims`, () => {
      const path = fileURLToPath(new URL(name, SRC));
      expect(existsSync(path)).toBe(true);
      const buf = readFileSync(path);
      // A checkout that never pulled LFS has stubs, not images.
      if (isLfsPointer(buf)) return;

      const { width, height } = imageSize(buf, name);
      const claims = claimedSizes(row);
      expect(claims.length).toBeGreaterThan(0);
      // One of the stated pairs must BE this file. The others describe the
      // original it was reduced from, which is not on disk to check.
      expect(claims).toContainEqual([width, height]);
      // Equirectangular, so 2:1 — a row quoting a size off that ratio is
      // describing something other than the map it names.
      expect(width / height).toBeGreaterThan(1.98);
      expect(width / height).toBeLessThan(2.02);
    });
  }
});
