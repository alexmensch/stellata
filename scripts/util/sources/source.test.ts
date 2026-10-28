import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { defineArtifact } from '../tsv/artifact-pure';
import { REPO_ROOT } from '../paths';
import { sourceRowRef, sourceRowRefText } from './row-ref-pure';
import { defineSource, readArtifact, streamArtifact } from './source';

mkdirSync(join(REPO_ROOT, 'build'), { recursive: true });
const dir = mkdtempSync(join(REPO_ROOT, 'build', 'source-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string): string {
  writeFileSync(join(dir, name), content);
  return relative(REPO_ROOT, join(dir, name));
}

const POINTER = 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n';

describe('defineSource', () => {
  it('parses the declared file, passing read arguments through', () => {
    const src = defineSource({
      file: file('a.txt', 'one\ntwo\n'),
      hint: 'Re-run `x`.',
      parse: (input, sep: string) => input.text().trim().split('\n').join(sep),
    });
    expect(src.read('+')).toBe('one+two');
  });

  it('throws naming the file, git lfs pull and the hint on a missing file', () => {
    const src = defineSource({ file: relative(REPO_ROOT, join(dir, 'absent.tsv')), hint: 'Re-run `x`.', parse: () => 0 });
    expect(() => src.read()).toThrow(/absent\.tsv is missing or an unsmudged LFS pointer.*git lfs pull.*Re-run `x`\./);
  });

  it('treats an LFS pointer stub as missing', () => {
    const src = defineSource({ file: file('stub.tsv', POINTER), hint: 'h', parse: () => 0 });
    expect(() => src.read()).toThrow(/stub\.tsv is missing or an unsmudged LFS pointer/);
  });

  it('checks and lists every member the declared file names', () => {
    const member = file('m1.bin', 'x');
    const manifest = file('manifest.txt', `${member}\n${relative(REPO_ROOT, join(dir, 'm2.bin'))}\n`);
    const src = defineSource({
      file: manifest,
      hint: 'h',
      members: (input) => input.text().trim().split('\n').map((f) => ({ file: f, hint: 'h' })),
      parse: () => 0,
    });
    expect(src.files()).toEqual([manifest, member, relative(REPO_ROOT, join(dir, 'm2.bin'))]);
    expect(() => src.read()).toThrow(/m2\.bin is missing/);
  });

  it('hands the parse its opened members, and refuses an undeclared one', () => {
    const extra = file('extra.txt', 'x\n');
    const src = defineSource({
      file: file('main.txt', 'm\n'),
      hint: 'h',
      members: [{ file: extra, hint: 'h' }],
      parse: (input) => [input.members.map((m) => m.text()), input.member(extra).file],
    });
    expect(src.read()).toEqual([['x\n'], extra]);
    const stray = defineSource({ file: file('main2.txt', 'm\n'), hint: 'h', parse: (input) => input.member('nope') });
    expect(() => stray.read()).toThrow(/nope is not a declared member/);
  });

  it('lists fixed members without opening the declared file', () => {
    const src = defineSource({
      file: relative(REPO_ROOT, join(dir, 'pointer-only.tsv')),
      hint: 'h',
      members: [{ file: 'm.tsv', hint: 'h' }],
      parse: () => 0,
    });
    expect(src.files()).toEqual([relative(REPO_ROOT, join(dir, 'pointer-only.tsv')), 'm.tsv']);
  });

  it('streams lines', async () => {
    const src = defineSource({
      file: file('lines.txt', 'a\nb\n'),
      hint: 'h',
      parse: async (input) => {
        const seen: string[] = [];
        await input.lines((l) => seen.push(l));
        return seen;
      },
    });
    expect(await src.read()).toEqual(['a', 'b']);
  });
});

describe('artifact reads', () => {
  const art = (name: string) => defineArtifact({
    file: relative(REPO_ROOT, join(dir, name)),
    columns: ['k'] as const,
    hint: 'h',
    order: 'as-given',
    decode: (row) => row.text('k'),
    encode: (k: string | null) => ({ k: k ?? '' }),
  });

  it('reads and streams through the codec', async () => {
    file('art.tsv', 'k\nx\ny\n');
    expect(readArtifact(art('art.tsv'))).toEqual(['x', 'y']);
    const seen: (string | null)[] = [];
    await streamArtifact(art('art.tsv'), (r) => seen.push(r));
    expect(seen).toEqual(['x', 'y']);
  });

  it('fails a missing artifact before decoding', () => {
    expect(() => readArtifact(art('none.tsv'))).toThrow(/none\.tsv is missing/);
  });
});

describe('SourceRowRef', () => {
  it('prints <id>:<row>', () => {
    const src = { file: 'f', rowKey: { id: 'spine', text: (line: number) => String(line) } };
    expect(sourceRowRefText(sourceRowRef(src, 42))).toBe('spine:42');
  });
});
