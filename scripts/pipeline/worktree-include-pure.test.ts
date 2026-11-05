import { describe, expect, it } from 'vitest';

import { CATALOG_CHUNK_FILENAME } from '../../src/catalog-format/record/catalog-pure';
import { DUST_CHUNK, TEXTURE_MEMBERS } from '../../src/catalog-format/public-artifacts/public-artifacts';
import { escapeRegExp } from '../util/escape-regexp';
import { memberGlob, renderWorktreeInclude } from './worktree-include-pure';

const globMatches = (glob: string, name: string): boolean =>
  new RegExp(`^${glob.split('*').map(escapeRegExp).join('.*')}$`).test(name);

describe('memberGlob', () => {
  it.each([
    [CATALOG_CHUNK_FILENAME, 'catalog.bin.*'],
    [DUST_CHUNK, 'chunk_*_*_*.bin'],
    [TEXTURE_MEMBERS.colourMap, '*-*.jpg'],
    [TEXTURE_MEMBERS.ringStrip, '*-rings.png'],
    [TEXTURE_MEMBERS.reliefMap, '*-*.webp'],
    [/^a{2,3}b?c\.d$/, '*c.d'],
  ])('%s reads as %s', (member, glob) => {
    expect(memberGlob(member)).toBe(glob);
  });

  it.each([
    [CATALOG_CHUNK_FILENAME, ['catalog.bin.0', 'catalog.bin.12']],
    [DUST_CHUNK, ['chunk_0_1_2.bin']],
    [TEXTURE_MEMBERS.reliefMap, ['mars-normal.webp', 'earth-horizon-a.webp']],
  ])('%s: the glob matches every member', (member, names) => {
    for (const name of names) {
      expect(member.test(name)).toBe(true);
      expect(globMatches(memberGlob(member), name)).toBe(true);
    }
  });

  it.each([
    [/catalog\.bin/, 'not anchored'],
    [/^a\$/, 'not anchored'],
    [/^a\\$/, "glob metacharacter '\\'"],
    [/^a|b$/, "no glob: '|'"],
    [/^a\*$/, "glob metacharacter '*'"],
    [/^a\.bin$/i, "flags 'i'"],
  ])('refuses %s', (member, message) => {
    expect(() => memberGlob(member)).toThrow(message);
  });
});

describe('renderWorktreeInclude', () => {
  it('lists public/ and build/ files and stamped families, sorted', () => {
    const text = renderWorktreeInclude([
      {
        files: ['public/b.json', 'src/committed.tsv', 'build/stamps/b.json'],
        families: [
          { dir: 'public/chunks', member: /^c\d+\.bin$/, stamped: true },
          { dir: 'build/previous', member: ['x.tsv'], stamped: false },
        ],
      },
      { files: ['build/stamps/a.json'], families: [{ dir: 'public/rosters', member: ['p.json', 'q.json'], stamped: true }] },
    ]);
    expect(text.split('\n')).toEqual([
      'build/stamps/a.json',
      'build/stamps/b.json',
      'public/b.json',
      'public/chunks/c*.bin',
      'public/rosters/p.json',
      'public/rosters/q.json',
      '',
    ]);
  });
});
