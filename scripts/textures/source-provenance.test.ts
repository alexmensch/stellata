// Mechanical half of data/textures/src/README.md § Auditing: the pins read
// each FILE's header, never the prose beside it.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lfsContentReadable } from '../util/paths';
import { imageSize } from './image-header-pure';

const SRC = new URL('../../data/textures/src/', import.meta.url);
const README = fileURLToPath(new URL('README.md', SRC));

const table = readFileSync(README, 'utf8')
  .split('\n')
  .filter(l => l.startsWith('| `'));

/** Rows in the table, and rows naming a file this module can read a header
 *  out of. Both are pinned: the difference is the silent-coverage-loss gap —
 *  four authored ring tables carry no image to check. */
const ROW_COUNT = 28;
const IMAGE_ROW_COUNT = 24;
const READABLE = /\.(jpg|tif|webp)$/;
/** Extensions a row may carry without an image header. Anything else is a
 *  new source type that would drop out of coverage unannounced. */
const NON_IMAGE = /\.(txt|tsv)$/;

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

const rowFiles = table.map(fileOf);
const imageRows = table.filter(row => READABLE.test(fileOf(row)));

// The LFS-stub gate every artifact-backed suite here rides, and the warning
// that keeps a self-skip from reading as a pass (scripts/util/README.md).
const sourcesArePointers = imageRows.some(
  row => !lfsContentReadable(fileURLToPath(new URL(fileOf(row), SRC))),
);
if (sourcesArePointers) {
  console.warn(
    '[source-provenance] skipping header pins — frozen sources are LFS ' +
      'pointers, not images. Run `git lfs pull` to exercise them.',
  );
}

describe('every provenance row matches the file it describes', () => {
  // A table that stopped parsing, or a source that quietly left coverage,
  // would pass every pin below. Both counts are exact for that reason: the
  // row total alone would tolerate losing four image rows.
  it('parses every row, and knows how many carry a checkable image', () => {
    expect(table.length).toBe(ROW_COUNT);
    expect(imageRows).toHaveLength(IMAGE_ROW_COUNT);
  });

  it('accounts for every row that carries no image header', () => {
    const unreadable = rowFiles.filter(name => !READABLE.test(name));
    expect(unreadable).toHaveLength(ROW_COUNT - IMAGE_ROW_COUNT);
    for (const name of unreadable) expect(name).toMatch(NON_IMAGE);
  });

  for (const row of imageRows) {
    const name = fileOf(row);

    it.skipIf(sourcesArePointers)(`${name} is the size its row claims`, () => {
      const path = fileURLToPath(new URL(name, SRC));
      expect(existsSync(path)).toBe(true);
      const { width, height } = imageSize(readFileSync(path), name);
      const claims = claimedSizes(row);
      expect(claims.length).toBeGreaterThan(0);
      // The README's own rule is that a row states the frozen file's size
      // FIRST, before any dimensions of the original it was reduced from —
      // so pin position, not just membership. Containment alone would pass a
      // row that led with the original.
      expect(claims[0]).toEqual([width, height]);
      // Equirectangular, so 2:1 — a row quoting a size off that ratio is
      // describing something other than the map it names.
      expect(width / height).toBeGreaterThan(1.98);
      expect(width / height).toBeLessThan(2.02);
    });
  }
});

/** A `NAME = { "key": number, ... }` table out of build-textures.py. */
const pyStrengths = (name: string): Record<string, number> => {
  const src = readFileSync(resolve(__dirname, 'build-textures.py'), 'utf-8');
  const block = new RegExp(`${name} = \\{([^}]*)\\}`).exec(src);
  expect(block, `${name} block`).not.toBeNull();
  const out: Record<string, number> = {};
  for (const m of block![1].matchAll(/"([a-z-]+)": ([\d.]+)/g)) {
    out[m[1]] = Number(m[2]);
  }
  expect(Object.keys(out).length).toBeGreaterThan(0);
  return out;
};

const rowFor = (body: string): string => {
  const row = imageRows.find(r => fileOf(r).startsWith(`${body}-`));
  if (!row) throw new Error(`no provenance row for ${body}`);
  return row;
};

// The dimensions above are measurable; the colour a build INVENTS is not, so
// the row is the only record of it and nothing held that row to the constant
// it describes. These pins do, both directions — a retune that leaves the
// prose behind fails, and so does prose claiming a treatment the build
// doesn't apply. data/textures/src/README.md § Auditing.
describe('every colour-invention claim matches the constant behind it', () => {
  const HALF_CHROMA = /half the representative chroma/;
  const FULL_CHROMA = /FULL representative/;
  const HALFWAY_GRAY = /pulled halfway to gray/;

  it('states the grayscale-source tint each row actually gets', () => {
    const tint = pyStrengths('TINT_STRENGTH');
    for (const [body, strength] of Object.entries(tint)) {
      const row = rowFor(body);
      if (strength === 0.5) expect(row, body).toMatch(HALF_CHROMA);
      else if (strength === 1.0) expect(row, body).toMatch(FULL_CHROMA);
      else throw new Error(`${body}: no row wording for tint ${strength}`);
    }
    // And no row may claim a tint the build does not apply.
    for (const row of imageRows) {
      if (!HALF_CHROMA.test(row) && !FULL_CHROMA.test(row)) continue;
      const body = Object.keys(tint).find(b => fileOf(row).startsWith(`${b}-`));
      expect(body, `${fileOf(row)} claims a tint`).toBeDefined();
    }
  });

  it('states the enhanced-colour pull-back each row actually gets', () => {
    const desaturate = pyStrengths('DESATURATE');
    for (const [body, strength] of Object.entries(desaturate)) {
      expect(strength, body).toBe(0.5);
      expect(rowFor(body), body).toMatch(HALFWAY_GRAY);
    }
    const claiming = imageRows.filter(r => HALFWAY_GRAY.test(r)).map(fileOf);
    expect(claiming).toHaveLength(Object.keys(desaturate).length);
  });
});
