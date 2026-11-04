import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashBytes, inputHashes } from './build-stamp';
import { tsIdentity } from './code-identity';
import { inputHashesAt } from './input-hashes-at';

describe('inputHashesAt', () => {
  let root: string;
  let commit: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (name: string, text: string) => writeFileSync(join(root, name), text);
  const hashesOf = (names: string[]) => inputHashes(names.map((n) => join(root, n)), root);

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'input-hashes-at-'));
    git('init', '-q');
    write('.gitignore', '*.log\n');
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
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

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

  it('is unknown for an input git does not track the content of', () => {
    expect(inputHashesAt(commit, hashesOf(['data.tsv', 'build.log']), root))
      .toEqual({ kind: 'unknown', reason: 'build.log not in git' });
  });
});
