import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { inputHashes } from './build-stamp';
import { tsIdentity } from './code-identity';
import { deletedSiblingsSince, inputHashesAt, onDiskHashes } from './input-hashes-at';
import { hashBytes } from './stamp-hash';

describe('inputHashesAt', () => {
  let root: string;
  let commit: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (name: string, text: string) => writeFileSync(join(root, name), text);
  const hashesOf = (names: string[]) => inputHashes(names.map((n) => join(root, n)), root);
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  const pointer = (content: string) =>
    `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(content)}\nsize ${content.length}\n`;

  beforeAll(() => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    root = mkdtempSync(join(tmpdir(), 'input-hashes-at-'));
    git('init', '-q');
    write('.gitignore', '*.log\n');
    write('.gitattributes', '*.bin filter=lfs\n');
    write('stored.bin', pointer('payload'));
    write('missing.bin', pointer('elsewhere'));
    write('data.tsv', 'a\n');
    write('kept.tsv', 'k\n');
    write('code.ts', 'export const x = 1;\n');
    write('gone.tsv', 'g\n');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
    commit = git('rev-parse', 'HEAD');
    write('data.tsv', 'b\n');
    write('code.ts', 'export const x = 2;\n');
    write('new.tsv', 'n\n');
    write('build.log', 'l\n');
    write('stored.bin', 'edited\n');
    write('missing.bin', 'edited\n');
    const object = join(root, '.git', 'lfs', 'objects', sha256('payload').slice(0, 2), sha256('payload').slice(2, 4));
    mkdirSync(object, { recursive: true });
    writeFileSync(join(object, sha256('payload')), 'payload');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it('re-hashes each changed input from the commit\'s copy and keeps the rest, in the same key order', () => {
    const inputs = hashesOf(['code.ts', 'data.tsv', 'kept.tsv', 'new.tsv']);
    const at = inputHashesAt(commit, inputs, root);
    expect(at).toEqual({
      kind: 'hashed',
      hashes: {
        'code.ts': tsIdentity('export const x = 1;\n'),
        'data.tsv': hashBytes('a\n'),
        'kept.tsv': inputs['kept.tsv'],
        'new.tsv': null,
      },
    });
    expect(at.kind === 'hashed' && Object.keys(at.hashes)).toEqual(Object.keys(inputs));
  });

  it('hands back the inputs unchanged when nothing differs, and hashes a file absent on disk but stored', () => {
    expect(inputHashesAt(commit, hashesOf(['kept.tsv']), root))
      .toEqual({ kind: 'hashed', hashes: hashesOf(['kept.tsv']) });
    const inputs = { 'gone.tsv': hashBytes('g\n') };
    rmSync(join(root, 'gone.tsv'));
    expect(inputHashesAt(commit, { 'gone.tsv': null }, root)).toEqual({ kind: 'hashed', hashes: inputs });
  });

  it('is unknown for an input git does not track the content of, unless its hash at the commit is known', () => {
    expect(inputHashesAt(commit, hashesOf(['data.tsv', 'build.log']), root))
      .toEqual({ kind: 'unknown', reason: 'build.log not in git' });
    expect(inputHashesAt(commit, hashesOf(['build.log', 'kept.tsv']), root, { 'build.log': 'recorded' }))
      .toEqual({ kind: 'hashed', hashes: { 'build.log': 'recorded', 'kept.tsv': hashBytes('k\n') } });
  });

  it('hashes an LFS input from the local object its stored pointer names, never fetching one', () => {
    expect(inputHashesAt(commit, hashesOf(['stored.bin']), root))
      .toEqual({ kind: 'hashed', hashes: { 'stored.bin': hashBytes('payload') } });
    expect(inputHashesAt(commit, hashesOf(['missing.bin']), root))
      .toEqual({ kind: 'unknown', reason: `missing.bin: its LFS content at ${commit} is not stored locally` });
  });

  it('onDiskHashes takes each path it is handed and hashes the rest from disk, code by identity, absent as null', () => {
    expect(onDiskHashes(['kept.tsv', 'data.tsv', 'code.ts', 'nowhere.tsv'], { 'kept.tsv': 'handed' }, root)).toEqual({
      'kept.tsv': 'handed', 'data.tsv': hashBytes('b\n'), 'code.ts': tsIdentity('export const x = 2;\n'), 'nowhere.tsv': null,
    });
  });

  it('deletedSiblingsSince lists a file deleted since the commit beside a code input, and none beside no code input', () => {
    rmSync(join(root, 'gone.tsv'), { force: true });
    expect(deletedSiblingsSince(commit, ['code.ts', 'data.tsv'], root)).toEqual(['gone.tsv']);
    expect(deletedSiblingsSince(commit, ['data.tsv'], root)).toEqual([]);
  });
});
